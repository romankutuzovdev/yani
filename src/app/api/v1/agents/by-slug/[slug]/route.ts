import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { asStringArray } from "@/lib/utils";

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
      skills: {
        where: { enabled: true, visible: true, skill: { enabled: true } },
        include: { skill: true },
        orderBy: { sortOrder: "asc" },
      },
      widgets: { where: { enabled: true }, take: 1 },
    },
  });

  if (!agent || !agent.enabled) return error("Агент не найден", 404);

  const widgetGreeting =
    agent.widgets[0] && typeof agent.widgets[0].config === "string"
      ? (() => {
          try {
            return (JSON.parse(agent.widgets[0].config) as { greeting?: string }).greeting;
          } catch {
            return undefined;
          }
        })()
      : undefined;

  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      logoUrl: agent.logoUrl || "/brand/yani-logo.png",
      greeting:
        agent.greeting ||
        widgetGreeting ||
        `Привет! Я ${agent.name}. Чем помочь?`,
      status: agent.status,
      statusMessage: agent.statusMessage,
      character: agent.character,
      widget: agent.widgets[0] ?? null,
      tools: agent.tools.map((t) => ({
        name: t.tool.name,
        description: t.tool.description,
      })),
      skills: agent.skills.map((as) => ({
        id: as.skill.id,
        name: as.skill.name,
        description: as.skill.description,
        iconUrl: as.skill.iconUrl,
        model: as.skill.model,
        sortOrder: as.sortOrder,
        tools: asStringArray(as.skill.tools),
      })),
    },
  });
}
