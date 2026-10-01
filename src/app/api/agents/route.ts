import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { slugify } from "@/lib/utils";

const agentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
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
  maxTokens: z.number().int().min(256).max(32000).optional(),
  timeoutMs: z.number().int().min(5000).optional(),
  skillIds: z.array(z.string()).optional(),
  toolIds: z.array(z.string()).optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const agents = await prisma.agent.findMany({
    include: {
      character: { include: { assets: true } },
      skills: { include: { skill: true } },
      tools: { include: { tool: true } },
      _count: { select: { tasks: true, memories: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return json({ agents });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  try {
    const body = agentSchema.parse(await req.json());
    let slug = slugify(body.name) || "agent";
    const existing = await prisma.agent.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    const character = await prisma.agentCharacter.create({
      data: {
        name: body.name,
        description: body.description ?? "",
        defaultState: "IDLE",
      },
    });

    const agent = await prisma.agent.create({
      data: {
        name: body.name,
        slug,
        description: body.description ?? "",
        personality: body.personality ?? "friendly",
        role: body.role ?? "AI assistant",
        communicationStyle: body.communicationStyle ?? "clear and helpful",
        rules: body.rules ?? "",
        goals: body.goals ?? "",
        restrictions: body.restrictions ?? "",
        additionalInstructions: body.additionalInstructions ?? "",
        systemPrompt: body.systemPrompt ?? "",
        model: body.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
        temperature: body.temperature ?? 0.7,
        maxIterations: body.maxIterations ?? 10,
        maxTokens: body.maxTokens ?? 4096,
        timeoutMs: body.timeoutMs ?? 120000,
        ownerId: admin.id,
        characterId: character.id,
        skills: body.skillIds?.length
          ? { create: body.skillIds.map((skillId) => ({ skillId })) }
          : undefined,
        tools: body.toolIds?.length
          ? { create: body.toolIds.map((toolId) => ({ toolId })) }
          : undefined,
      },
      include: {
        character: { include: { assets: true } },
        skills: { include: { skill: true } },
        tools: { include: { tool: true } },
      },
    });

    await prisma.widget.create({
      data: {
        agentId: agent.id,
        name: `${agent.name} Widget`,
        config: { greeting: `Hi! I am ${agent.name}. How can I help?` },
      },
    });

    await writeLog({
      type: "agent",
      message: `Created agent ${agent.name}`,
      agentId: agent.id,
      userId: admin.id,
    });

    return json({ agent }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed to create agent", 500);
  }
}
