import { NextRequest } from "next/server";
import { error, json, requireCabinet } from "@/lib/api";
import { getCrmHealth } from "@/lib/crmHealth";
import { prisma } from "@/lib/db";
import { resolveCrmAgentId } from "@/lib/crm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cabinet = await requireCabinet();
  if (cabinet instanceof Response) return cabinet;

  const agentId = await resolveCrmAgentId(req.nextUrl.searchParams.get("agentId"));
  if (agentId instanceof Response) return agentId;

  const health = await getCrmHealth();
  const playbookId = req.nextUrl.searchParams.get("playbookId")?.trim();

  let playbookQueues = null;
  if (playbookId) {
    const playbook = await prisma.salesPlaybook.findFirst({
      where: { id: playbookId, agentId },
      select: { id: true },
    });
    if (!playbook) return error("Навык продажи не найден", 404);
    const [draft, approved, waiting, dead, pendingCampaign] = await Promise.all([
      prisma.crmOutboxMessage.count({
        where: { status: "DRAFT", connection: { playbookId } },
      }),
      prisma.crmOutboxMessage.count({
        where: { status: "APPROVED", connection: { playbookId } },
      }),
      prisma.crmMessage.count({
        where: {
          direction: "INBOUND",
          status: "WAITING_AGENT",
          conversation: { lead: { playbookId } },
        },
      }),
      prisma.crmDeadLetter.count({ where: { playbookId, resolvedAt: null } }),
      prisma.crmCampaignItem.count({
        where: { status: "PENDING", campaign: { playbookId } },
      }),
    ]);
    playbookQueues = { draft, approved, waiting, dead, pendingCampaign };
  }

  const recentAudit = await prisma.crmAuditEvent.findMany({
    where: playbookId ? { playbookId } : { agentId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      entityType: true,
      entityId: true,
    },
  });

  return json({ health, playbookQueues, recentAudit });
}
