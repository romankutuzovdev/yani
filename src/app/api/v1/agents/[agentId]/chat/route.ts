import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey, writeLog } from "@/lib/api";
import { agentEngine } from "@/agent/AgentEngine";
import { writeMemory } from "@/memory";
import { asStringArray } from "@/lib/utils";
import { purgeExpiredChatMessages } from "@/lib/chatHistory";
import { enqueueMilli } from "@/lib/milliQueue";
import { ChatBusyError } from "@/lib/chatPool";
import { clientIp, guardChatIp, logVisitorRequest } from "@/lib/visitorGuard";
import { takeAgentRequestSlot } from "@/lib/agentQuota";
import { CHAT_UNAVAILABLE, toChatUserMessage } from "@/lib/chatUserError";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ agentId: string }> };

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin")),
  });
}

async function authAgent(req: NextRequest, agentId: string) {
  const authHeader = req.headers.get("authorization");
  // Anonymous widget chat is allowed with IP rate limit.
  // Prefer API key when provided.
  if (!authHeader) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    const rl = checkRateLimit(`anon-chat:${ip}:${agentId}`, 120);
    if (!rl.allowed) return { error: error("Rate limit exceeded", 429) };
    return { key: null };
  }

  const key = await resolveApiKey(authHeader);
  if (!key) return { error: error("Invalid API key", 401) };
  if (key.agentId && key.agentId !== agentId) {
    return { error: error("API key not allowed for this agent", 403) };
  }
  const scopes = asStringArray(key.scopes);
  if (!scopes.includes("chat") && !scopes.includes("*")) {
    return { error: error("Insufficient scope", 403) };
  }
  const rl = checkRateLimit(`apikey:${key.id}`, key.rateLimit);
  if (!rl.allowed) return { error: error("Rate limit exceeded", 429) };
  return { key };
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const origin = req.headers.get("origin");
  const auth = await authAgent(req, agentId);
  if ("error" in auth && auth.error) {
    const res = auth.error;
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent || !agent.enabled) {
    return error("Agent not found", 404);
  }

  try {
    const body = z
      .object({
        message: z.string().min(1),
        sessionId: z.string().default("widget"),
        skillId: z.string().optional().nullable(),
        stream: z.boolean().optional(),
      })
      .parse(await req.json());

    const ip = clientIp(req);
    const gate = await guardChatIp(ip, agentId);
    await logVisitorRequest({
      ip,
      agentId,
      agentName: agent.name,
      sessionId: body.sessionId,
      message: body.message,
    }).catch(() => undefined);
    if (!gate.ok) {
      const denied = error(gate.message, 403);
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => denied.headers.set(k, v));
      return denied;
    }

    const slot = await enqueueMilli(() => takeAgentRequestSlot(agentId));
    if (!slot.ok) {
      const denied = error(slot.message, 429, { code: slot.code });
      Object.entries(corsHeaders(origin)).forEach(([k, v]) => denied.headers.set(k, v));
      return denied;
    }

    void enqueueMilli(() => purgeExpiredChatMessages()).catch(() => undefined);

    const runTurn = async (onDelta?: (delta: string) => void) => {
      await prisma.chatMessage.create({
        data: {
          agentId,
          sessionId: body.sessionId,
          role: "user",
          content: body.message,
        },
      });

      await writeMemory({
        agentId,
        content: `Widget user: ${body.message}`,
        type: "SHORT_TERM",
      });

      const result = await agentEngine.run({
        agentId,
        instruction: body.message,
        sessionId: body.sessionId,
        skillIds: body.skillId ? [body.skillId] : undefined,
        limits: { maxIterations: Math.min(agent.maxIterations, 6) },
        onDelta,
      });
      const reply = result.success
        ? result.result || CHAT_UNAVAILABLE
        : result.result?.trim() || toChatUserMessage(result.error);
      await prisma.chatMessage.create({
        data: {
          agentId,
          sessionId: body.sessionId,
          role: "assistant",
          content: reply,
        },
      });
      await writeLog({
        level: result.success ? "INFO" : "ERROR",
        type: result.success ? "api_chat" : "chat_error",
        message: result.success
          ? `Public chat with ${agent.name}`
          : (result.detail || result.error || "Chat failed").slice(0, 4000),
        agentId,
        meta: {
          success: result.success,
          stream: Boolean(onDelta),
          sessionId: body.sessionId,
          message: body.message.slice(0, 200),
        },
      });
      return { result, reply };
    };

    if (body.stream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (payload: unknown) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };
          send({ status: "start" });
          try {
            const { result, reply } = await runTurn((delta) => send({ delta }));
            send({ done: true, reply, success: result.success });
          } catch (err) {
            const raw = err instanceof Error ? err.message : "Chat failed";
            console.error(`[chat] public ${agent.id}: ${raw}`);
            await writeLog({
              level: "ERROR",
              type: "chat_error",
              message: raw.slice(0, 4000),
              agentId,
              meta: { stream: true, sessionId: body.sessionId },
            });
            if (err instanceof ChatBusyError) {
              send({ error: err.message });
            } else {
              send({ error: toChatUserMessage(raw) });
            }
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    try {
      const { result, reply } = await runTurn();
      return json(
        {
          reply,
          success: result.success,
          status: agent.status,
        },
        { headers: corsHeaders(origin) },
      );
    } catch (err) {
      if (err instanceof ChatBusyError) {
        const denied = error(err.message, 429, { code: "busy" });
        Object.entries(corsHeaders(origin)).forEach(([k, v]) => denied.headers.set(k, v));
        return denied;
      }
      throw err;
    }
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    if (e instanceof ChatBusyError) {
      return error(e.message, 429, { code: "busy" });
    }
    const raw = e instanceof Error ? e.message : "Chat failed";
    console.error(`[chat] public ${agentId}: ${raw}`);
    await writeLog({
      level: "ERROR",
      type: "chat_error",
      message: raw.slice(0, 4000),
      agentId,
    });
    return error(toChatUserMessage(raw), 500);
  }
}
