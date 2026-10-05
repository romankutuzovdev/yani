import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey, writeLog } from "@/lib/api";
import { agentEngine } from "@/agent/AgentEngine";
import { writeMemory } from "@/memory";
import { asStringArray } from "@/lib/utils";
import { purgeExpiredChatMessages } from "@/lib/chatHistory";
import { enqueueMilli } from "@/lib/milliQueue";
import { clientIp, guardChatIp, logVisitorRequest } from "@/lib/visitorGuard";
import { takeAgentRequestSlot } from "@/lib/agentQuota";

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
    const rl = checkRateLimit(`anon-chat:${ip}:${agentId}`, 20);
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
    const gate = await guardChatIp(ip);
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

    const runTurn = (onDelta?: (delta: string) => void) =>
      enqueueMilli(async () => {
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
        const reply = result.result || result.error || "";
        await prisma.chatMessage.create({
          data: {
            agentId,
            sessionId: body.sessionId,
            role: "assistant",
            content: reply,
          },
        });
        await writeLog({
          type: "api_chat",
          message: `Public chat with ${agent.name}`,
          agentId,
          meta: { success: result.success, stream: Boolean(onDelta) },
        });
        return { result, reply };
      });

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
            send({ error: err instanceof Error ? err.message : "Chat failed" });
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

    const { result, reply } = await runTurn();

    return json(
      {
        reply,
        success: result.success,
        status: agent.status,
      },
      { headers: corsHeaders(origin) },
    );
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Chat failed", 500);
  }
}
