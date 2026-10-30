import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { asStringArray } from "@/lib/utils";
import { withDefaultHeroAssets } from "@/characters/defaults";

type Params = { params: Promise<{ slug: string }> };

const agentInclude = {
  character: { include: { assets: true } },
  tools: {
    where: { enabled: true },
    include: { tool: true },
  },
  skills: {
    where: { enabled: true, visible: true, skill: { enabled: true } },
    include: { skill: true },
    orderBy: { sortOrder: "asc" as const },
  },
  widgets: { where: { enabled: true }, take: 1 },
  docs: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: { id: true, title: true, url: true, openMode: true },
  },
};

async function findPublicAgent(slug: string) {
  if (slug.toLowerCase() === "primary") {
    const marked = await prisma.agent.findFirst({
      where: { isPrimary: true },
      include: agentInclude,
      orderBy: { updatedAt: "desc" },
    });
    if (marked) return marked;
    for (const fallback of ["yani", "alex"]) {
      const agent = await prisma.agent.findUnique({
        where: { slug: fallback },
        include: agentInclude,
      });
      if (agent?.enabled) return agent;
    }
    return null;
  }
  return prisma.agent.findUnique({
    where: { slug },
    include: agentInclude,
  });
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const agent = await findPublicAgent(slug);

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

    const assets = withDefaultHeroAssets(agent.character?.assets);
    const org = await prisma.user.findFirst({
      where: { orgAgentId: agent.id, role: "ORG" },
      select: { orgName: true },
    });

    return json({
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        orgName: org?.orgName?.trim() || "",
        description: agent.description,
        logoUrl: agent.logoUrl || "/brand/yani-logo.png",
        homeIconUrl: agent.homeIconUrl || "",
        greeting:
          agent.greeting ||
          widgetGreeting ||
          `Привет! Я ${agent.name}. Чем помочь?`,
        asideText: agent.asideText,
        status: agent.status,
        statusMessage: agent.statusMessage,
        character: agent.character
          ? { ...agent.character, assets }
          : {
              id: "default",
              name: agent.name,
              description: "",
              defaultState: "IDLE",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              assets,
            },
        widget: agent.widgets[0]
          ? {
              ...agent.widgets[0],
              config:
                typeof agent.widgets[0].config === "string"
                  ? (() => {
                      try {
                        return JSON.parse(agent.widgets[0].config as string);
                      } catch {
                        return {};
                      }
                    })()
                  : agent.widgets[0].config,
            }
          : null,
        tools: agent.tools.map((t) => ({
          name: t.tool.name,
          description: t.tool.description,
        })),
        docs: agent.docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          url: doc.url,
          openMode: doc.openMode === "direct" ? "direct" : "preview",
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
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Failed to load agent";
    if (/webSearchEnabled|no such column|no such table/i.test(message)) {
      return error(
        "База на сервере не совпадает со схемой (нет колонки/таблицы). Выполните apply-release или ALTER.",
        500,
      );
    }
    return error(message, 500);
  }
}
