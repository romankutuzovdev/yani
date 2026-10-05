import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey } from "@/lib/api";
import { withDefaultHeroAssets } from "@/characters/defaults";

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
  // Allow public read of basic agent card for widget bootstrap without key,
  // but hide sensitive fields.
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      character: { include: { assets: true } },
      widgets: { where: { enabled: true }, take: 1 },
    },
  });
  if (!agent || !agent.enabled) return error("Agent not found", 404);

  if (key) {
    const rl = checkRateLimit(`apikey:${key.id}:status`, key.rateLimit);
    if (!rl.allowed) return error("Rate limit exceeded", 429);
  }

  return json(
    {
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        logoUrl: agent.logoUrl || "/brand/yani-logo.png",
        status: agent.status,
        statusMessage: agent.statusMessage,
        character: agent.character
          ? { ...agent.character, assets: withDefaultHeroAssets(agent.character.assets) }
          : {
              id: "default",
              name: agent.name,
              description: "",
              defaultState: "IDLE",
              assets: withDefaultHeroAssets(null),
            },
        widget: agent.widgets[0] ?? null,
      },
    },
    { headers: cors(origin) },
  );
}
