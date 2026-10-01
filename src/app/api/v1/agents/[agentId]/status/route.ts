import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey } from "@/lib/api";

type Params = { params: Promise<{ agentId: string }> };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function GET(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const origin = req.headers.get("origin");
  const key = await resolveApiKey(req.headers.get("authorization"));
  if (key) {
    if (key.agentId && key.agentId !== agentId) return error("Forbidden", 403);
    const rl = checkRateLimit(`apikey:${key.id}:status`, key.rateLimit);
    if (!rl.allowed) return error("Rate limit exceeded", 429);
  }

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      status: true,
      statusMessage: true,
      enabled: true,
      character: { include: { assets: true } },
    },
  });
  if (!agent) return error("Agent not found", 404);
  return json({ agent }, { headers: cors(origin) });
}
