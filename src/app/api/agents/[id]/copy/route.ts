import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { slugify } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const source = await prisma.agent.findUnique({
    where: { id },
    include: {
      skills: true,
      tools: true,
      widgets: true,
      character: { include: { assets: true } },
    },
  });
  if (!source) return error("Agent not found", 404);

  const name = `${source.name} — копия`;
  const base = slugify(source.slug || source.name) || "agent";
  const slug = `${base}-${Date.now().toString(36)}`.slice(0, 80);

  try {
    const agent = await prisma.$transaction(async (tx) => {
      const character = await tx.agentCharacter.create({
        data: {
          name,
          description: source.character?.description ?? source.description,
          defaultState: source.character?.defaultState ?? "IDLE",
          assets: source.character?.assets.length
            ? {
                create: source.character.assets.map((asset) => ({
                  state: asset.state,
                  type: asset.type,
                  url: asset.url,
                  mimeType: asset.mimeType,
                  filename: asset.filename,
                  sizeBytes: asset.sizeBytes,
                })),
              }
            : undefined,
        },
      });

      const created = await tx.agent.create({
        data: {
          name,
          slug,
          description: source.description,
          logoUrl: source.logoUrl,
          greeting: source.greeting,
          personality: source.personality,
          role: source.role,
          communicationStyle: source.communicationStyle,
          rules: source.rules,
          goals: source.goals,
          restrictions: source.restrictions,
          additionalInstructions: source.additionalInstructions,
          systemPrompt: source.systemPrompt,
          model: source.model,
          temperature: source.temperature,
          maxIterations: source.maxIterations,
          maxTokens: source.maxTokens,
          timeoutMs: source.timeoutMs,
          dailyRequestLimit: source.dailyRequestLimit,
          monthlyRequestLimit: source.monthlyRequestLimit,
          enabled: source.enabled,
          ownerId: admin.id,
          characterId: character.id,
          skills: source.skills.length
            ? {
                create: source.skills.map((row) => ({
                  skillId: row.skillId,
                  enabled: row.enabled,
                  visible: row.visible,
                  sortOrder: row.sortOrder,
                })),
              }
            : undefined,
          tools: source.tools.length
            ? {
                create: source.tools.map((row) => ({
                  toolId: row.toolId,
                  enabled: row.enabled,
                  config: row.config,
                })),
              }
            : undefined,
        },
      });

      const widget = source.widgets[0];
      await tx.widget.create({
        data: {
          agentId: created.id,
          name: widget?.name ? `${widget.name} — копия` : `${name} Widget`,
          enabled: widget?.enabled ?? true,
          config: widget?.config ?? "{}",
        },
      });

      return created;
    });

    await writeLog({
      type: "agent",
      message: `Copied agent ${source.name} to ${agent.name}`,
      agentId: agent.id,
      userId: admin.id,
    });

    return json({ agent }, { status: 201 });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось скопировать агента", 500);
  }
}
