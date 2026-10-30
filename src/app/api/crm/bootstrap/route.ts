import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireCabinet } from "@/lib/api";
import { assertCrmSalesAccess } from "@/lib/crm";
import { listPlaybookLeads, playbookListSelect } from "@/lib/crmLeadsList";

export const dynamic = "force-dynamic";

/** One round-trip to open CRM: agents + playbooks + leads for the active skill. */
export async function GET(req: NextRequest) {
  const cabinet = await requireCabinet();
  if (cabinet instanceof Response) return cabinet;

  const requestedPlaybookId = req.nextUrl.searchParams.get("playbookId")?.trim() || "";
  const requestedAgentId = req.nextUrl.searchParams.get("agentId")?.trim() || "";

  // Resolve agent once (do not call resolveCrmAgentId — it would re-auth).
  let agentId: string;
  if (cabinet.orgAgentId) {
    const allowed = await assertCrmSalesAccess(cabinet.orgAgentId, cabinet.orgAgentId);
    if (allowed instanceof Response) return allowed;
    agentId = cabinet.orgAgentId;
  } else if (requestedAgentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: requestedAgentId },
      select: { id: true },
    });
    if (!agent) return error("Агент не найден", 404);
    agentId = agent.id;
  } else {
    const agent = await prisma.agent.findFirst({
      where: { enabled: true },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
      select: { id: true },
    });
    if (!agent) return error("Сначала создайте агента", 404);
    agentId = agent.id;
  }

  const [agents, playbooks, org] = await Promise.all([
    prisma.agent.findMany({
      where: cabinet.orgAgentId ? { id: cabinet.orgAgentId } : undefined,
      select: { id: true, name: true, isPrimary: true, slug: true, enabled: true },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
      take: 50,
    }),
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

  if (!agents.some((row) => row.id === agentId)) {
    return error("Агент не найден", 404);
  }

  const playbookId =
    (requestedPlaybookId && playbooks.some((row) => row.id === requestedPlaybookId)
      ? requestedPlaybookId
      : playbooks[0]?.id) || "";

  const leads = playbookId ? await listPlaybookLeads(playbookId) : [];
  const [leadTotal, pendingQueue] = playbookId
    ? await Promise.all([
        prisma.salesLead.count({ where: { playbookId } }),
        prisma.crmCampaignItem.count({
          where: {
            status: "PENDING",
            campaign: { playbookId, status: { in: ["DRAFT", "RUNNING", "PAUSED"] } },
          },
        }),
      ])
    : [0, 0];

  return json({
    agentId,
    agents,
    playbooks,
    playbookId,
    leads,
    board: { leadTotal, pendingQueue, shown: leads.length },
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
