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

  const light = req.nextUrl.searchParams.get("light") === "1";
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

  // Board polls with light=1 every 30s — skip global COUNT storm; scoped queues are enough.
  if (light) {
    const engine = process.env.DATABASE_URL?.startsWith("postgres") ? "postgresql" : "sqlite";
    return json({
      health: {
        status: "ok",
        checkedAt: new Date().toISOString(),
        latencyMs: 0,
        database: { status: "ok", error: "" },
        redis: { status: "ok" },
        queues: {
          outboxDraft: playbookQueues?.draft ?? 0,
          outboxApproved: playbookQueues?.approved ?? 0,
          outboxSending: 0,
          outboxFailed: 0,
          inboundWaiting: playbookQueues?.waiting ?? 0,
          inboundFailed: 0,
          campaignsRunning: 0,
          campaignPending: playbookQueues?.pendingCampaign ?? 0,
          deadLettersOpen: playbookQueues?.dead ?? 0,
        },
        connections: [],
        engine,
      },
      playbookQueues,
      recentAudit: [],
    });
  }

  const [health, recentAudit] = await Promise.all([
    getCrmHealth(),
    prisma.crmAuditEvent.findMany({
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
    }),
  ]);

  return json({ health, playbookQueues, recentAudit });
}
