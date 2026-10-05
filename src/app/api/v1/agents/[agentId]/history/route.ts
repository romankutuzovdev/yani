import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json } from "@/lib/api";
import { deleteChatSessions, purgeExpiredChatMessages } from "@/lib/chatHistory";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ agentId: string }> };

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const origin = req.headers.get("origin");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const rl = checkRateLimit(`chat-history:${ip}:${agentId}`, 10);
  if (!rl.allowed) {
    const res = error("Rate limit exceeded", 429);
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => res.headers.set(k, v));
    return res;
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } });
  if (!agent) return error("Agent not found", 404);

  try {
    const body = z
      .object({ sessionIds: z.array(z.string().min(1).max(80)).max(50) })
      .parse(await req.json());
    await purgeExpiredChatMessages();
    const deleted = await deleteChatSessions(agentId, body.sessionIds);
    return json({ ok: true, deleted }, { headers: corsHeaders(origin) });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed to clear history", 500);
  }
}
