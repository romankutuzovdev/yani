import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: {
      character: { include: { assets: true } },
      skills: {
        include: { skill: true },
        orderBy: { sortOrder: "asc" },
      },
      tools: { include: { tool: true } },
      widgets: true,
      tasks: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!agent) return error("Agent not found", 404);
  return json({ agent });
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  greeting: z.string().optional(),
  personality: z.string().optional(),
  role: z.string().optional(),
  communicationStyle: z.string().optional(),
  rules: z.string().optional(),
  goals: z.string().optional(),
  restrictions: z.string().optional(),
  additionalInstructions: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxIterations: z.number().int().min(1).max(50).optional(),
  maxTokens: z.number().int().optional(),
  timeoutMs: z.number().int().optional(),
  enabled: z.boolean().optional(),
  skillIds: z.array(z.string()).optional(),
  /** Full assignment with order/visibility for the agent */
  skillAssignments: z
    .array(
      z.object({
        skillId: z.string(),
        enabled: z.boolean().optional(),
        visible: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .optional(),
  toolIds: z.array(z.string()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  try {
    const body = updateSchema.parse(await req.json());
    const existing = await prisma.agent.findUnique({ where: { id } });
    if (!existing) return error("Agent not found", 404);

    const { skillIds, skillAssignments, toolIds, ...data } = body;

    if (skillAssignments) {
      await prisma.agentSkill.deleteMany({ where: { agentId: id } });
      if (skillAssignments.length) {
        await prisma.agentSkill.createMany({
          data: skillAssignments.map((a, i) => ({
            agentId: id,
            skillId: a.skillId,
            enabled: a.enabled ?? true,
            visible: a.visible ?? true,
            sortOrder: a.sortOrder ?? i,
          })),
        });
      }
    } else if (skillIds) {
      await prisma.agentSkill.deleteMany({ where: { agentId: id } });
      if (skillIds.length) {
        await prisma.agentSkill.createMany({
          data: skillIds.map((skillId, i) => ({
            agentId: id,
            skillId,
            sortOrder: i,
            visible: true,
            enabled: true,
          })),
        });
      }
    }
    if (toolIds) {
      await prisma.agentTool.deleteMany({ where: { agentId: id } });
      if (toolIds.length) {
        await prisma.agentTool.createMany({
          data: toolIds.map((toolId) => ({ agentId: id, toolId })),
        });
      }
    }

    const agent = await prisma.agent.update({
      where: { id },
      data,
      include: {
        character: { include: { assets: true } },
        skills: {
          include: { skill: true },
          orderBy: { sortOrder: "asc" },
        },
        tools: { include: { tool: true } },
      },
    });

    await writeLog({
      type: "agent",
      message: `Updated agent ${agent.name}`,
      agentId: agent.id,
      userId: admin.id,
    });

    return json({ agent });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return error("Agent not found", 404);
  await prisma.agent.delete({ where: { id } });
  if (agent.characterId) {
    await prisma.agentCharacter.delete({ where: { id: agent.characterId } }).catch(() => undefined);
  }
  await writeLog({
    type: "agent",
    message: `Deleted agent ${agent.name}`,
    userId: admin.id,
  });
  return json({ ok: true });
}
