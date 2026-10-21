import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { resolveCrmAgentId } from "@/lib/crm";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1, "Введите название").max(120),
  product: z.string().trim().max(4000).optional(),
  systemPrompt: z.string().trim().max(20_000).optional(),
  goals: z.string().trim().max(4000).optional(),
  communicationStyle: z.string().trim().max(4000).optional(),
  restrictions: z.string().trim().max(4000).optional(),
  qualificationQuestions: z.string().trim().max(8000).optional(),
});

export async function GET(req: NextRequest) {
  const agentId = await resolveCrmAgentId(req.nextUrl.searchParams.get("agentId"));
  if (agentId instanceof Response) return agentId;

  const [agent, playbooks] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true } }),
    prisma.salesPlaybook.findMany({
      where: { agentId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { leads: true, documents: true } },
      },
    }),
  ]);

  return json({ agent, playbooks });
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    const agentId = await resolveCrmAgentId(body.agentId);
    if (agentId instanceof Response) return agentId;

    const playbook = await prisma.salesPlaybook.create({
      data: {
        agentId,
        name: body.name,
        product: body.product ?? "",
        systemPrompt: body.systemPrompt ?? "",
        goals: body.goals ?? "",
        communicationStyle: body.communicationStyle ?? "",
        restrictions: body.restrictions ?? "",
        qualificationQuestions: body.qualificationQuestions ?? "",
      },
    });
    await writeLog({
      type: "crm_playbook",
      message: `Создан навык продажи «${playbook.name}»`,
      agentId,
    });
    return json({ playbook }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Проверьте поля");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return error("Навык с таким названием уже есть у этого агента", 409);
    }
    return error("Не удалось создать навык продажи", 500);
  }
}
