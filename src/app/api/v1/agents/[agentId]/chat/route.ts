import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey, writeLog } from "@/lib/api";
import { agentEngine } from "@/agent/AgentEngine";
import { writeMemory } from "@/memory";
import { asStringArray } from "@/lib/utils";

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
      })
      .parse(await req.json());

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
      limits: { maxIterations: Math.min(agent.maxIterations, 6) },
    });

    await prisma.chatMessage.create({
      data: {
        agentId,
        sessionId: body.sessionId,
        role: "assistant",
        content: result.result || result.error || "",
      },
    });

    await writeLog({
      type: "api_chat",
      message: `Public chat with ${agent.name}`,
      agentId,
      meta: { success: result.success },
    });

    return json(
      {
        reply: result.result || result.error,
        success: result.success,
        status: agent.status,
        forms: result.forms ?? [],
      },
      { headers: corsHeaders(origin) },
    );
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Chat failed", 500);
  }
}
