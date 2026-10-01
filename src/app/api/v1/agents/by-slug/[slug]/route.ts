import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const agent = await prisma.agent.findUnique({
    where: { slug },
    include: {
      character: { include: { assets: true } },
      tools: {
        where: { enabled: true },
        include: { tool: true },
      },
      widgets: { where: { enabled: true }, take: 1 },
    },
  });

  if (!agent || !agent.enabled) return error("Агент не найден", 404);

  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      status: agent.status,
      statusMessage: agent.statusMessage,
      character: agent.character,
      widget: agent.widgets[0] ?? null,
      tools: agent.tools.map((t) => ({
        name: t.tool.name,
        description: t.tool.description,
      })),
    },
  });
}
