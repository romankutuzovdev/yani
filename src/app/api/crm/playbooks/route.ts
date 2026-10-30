import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireCabinet, writeLog } from "@/lib/api";
import { resolveCrmAgentId } from "@/lib/crm";
import { assertOrgSalesPlaybookQuota } from "@/lib/orgAccess";
import { playbookListSelect } from "@/lib/crmLeadsList";

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

  const [agent, playbooks, org] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, name: true } }),
    prisma.salesPlaybook.findMany({
      where: { agentId },
      orderBy: { updatedAt: "desc" },
      select: playbookListSelect,
    }),
    prisma.user.findFirst({
      where: { orgAgentId: agentId, role: "ORG" },
      select: {
        salesEnabled: true,
        salesPlanName: true,
        salesPlanMonthlyPrice: true,
        salesPlaybookLimit: true,
        salesAgentLimit: true,
      },
    }),
  ]);

  return json({
    agent,
    playbooks,
    sales: org
      ? {
          enabled: org.salesEnabled,
          planName: org.salesPlanName,
          planMonthlyPrice: org.salesPlanMonthlyPrice,
          playbookLimit: org.salesPlaybookLimit,
          agentLimit: org.salesAgentLimit,
          playbookUsed: playbooks.length,
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    const agentId = await resolveCrmAgentId(body.agentId);
    if (agentId instanceof Response) return agentId;

    const cabinet = await requireCabinet();
    if (!(cabinet instanceof Response) && cabinet.orgAgentId) {
      const quota = await assertOrgSalesPlaybookQuota(agentId);
      if (!quota.ok) return error(quota.reason, 403);
    }

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
