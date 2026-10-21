import { prisma } from "@/lib/db";
import { pingCrmRedis } from "@/lib/crmRedis";

export async function getCrmHealth() {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  let databaseError = "";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (cause) {
    database = "error";
    databaseError = cause instanceof Error ? cause.message : "db error";
  }

  let redis: Awaited<ReturnType<typeof pingCrmRedis>> = {
    status: "disabled",
    error: "redis check skipped",
  };
  try {
    redis = await pingCrmRedis();
  } catch (cause) {
    redis = {
      status: "disabled",
      error: cause instanceof Error ? cause.message : "redis check failed",
    };
  }

  const [
    outboxDraft,
    outboxApproved,
    outboxSending,
    outboxFailed,
    inboundWaiting,
    inboundFailed,
    campaignsRunning,
    campaignPending,
    deadLettersOpen,
    connections,
  ] = await Promise.all([
    prisma.crmOutboxMessage.count({ where: { status: "DRAFT" } }),
    prisma.crmOutboxMessage.count({ where: { status: "APPROVED" } }),
    prisma.crmOutboxMessage.count({ where: { status: "SENDING" } }),
    prisma.crmOutboxMessage.count({ where: { status: "FAILED" } }),
    prisma.crmMessage.count({ where: { direction: "INBOUND", status: "WAITING_AGENT" } }),
    prisma.crmInboundEvent.count({ where: { status: "FAILED" } }),
    prisma.crmCampaign.count({ where: { status: "RUNNING" } }),
    prisma.crmCampaignItem.count({ where: { status: "PENDING" } }),
    prisma.crmDeadLetter.count({ where: { resolvedAt: null } }),
    prisma.crmChannelConnection.groupBy({
      by: ["type", "status"],
      _count: { _all: true },
    }),
  ]);

  const status =
    database === "error" ? "error" : outboxFailed > 20 || deadLettersOpen > 50 ? "degraded" : "ok";

  return {
    status,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - started,
    database: { status: database, error: databaseError },
    redis,
    queues: {
      outboxDraft,
      outboxApproved,
      outboxSending,
      outboxFailed,
      inboundWaiting,
      inboundFailed,
      campaignsRunning,
      campaignPending,
      deadLettersOpen,
    },
    connections: connections.map((row) => ({
      type: row.type,
      status: row.status,
      count: row._count._all,
    })),
    engine: process.env.DATABASE_URL?.startsWith("postgres") ? "postgresql" : "sqlite",
  };
}
