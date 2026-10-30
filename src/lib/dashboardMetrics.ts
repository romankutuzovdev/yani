import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/agentActivityStats";
import { minskParts, type UsageBucket, usagePeriod } from "@/lib/minskTime";

export type DashboardBucket = "day" | "week" | "month" | "year";

export type SalesPoint = {
  key: string;
  label: string;
  inbound: number;
  outbound: number;
  communicating: number;
  clients: number;
  messages: number;
  workMinutes: number;
};

export type SalesTotals = Omit<SalesPoint, "key" | "label">;

export type SupportAgentSeries = {
  agentId: string;
  name: string;
  totalInbound: number;
  points: Array<{ key: string; label: string; inbound: number }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function asUsageBucket(bucket: DashboardBucket): UsageBucket {
  return bucket;
}

/** How far back to look for each chart granularity. */
function lookbackDays(bucket: DashboardBucket) {
  if (bucket === "day") return 30;
  if (bucket === "week") return 12 * 7;
  if (bucket === "month") return 365;
  return 365 * 5;
}

type SalesBucket = {
  key: string;
  label: string;
  inbound: number;
  outbound: number;
  messages: number;
  workMinuteKeys: Set<string>;
  communicatingLeads: Set<string>;
  clientLeads: Set<string>;
};

function emptySales(period: { key: string; label: string }): SalesBucket {
  return {
    key: period.key,
    label: period.label,
    inbound: 0,
    outbound: 0,
    messages: 0,
    workMinuteKeys: new Set(),
    communicatingLeads: new Set(),
    clientLeads: new Set(),
  };
}

function minuteKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildPeriodKeys(bucket: DashboardBucket, since: Date, until: Date) {
  const keys: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  const step =
    bucket === "year"
      ? 40 * DAY_MS
      : bucket === "month"
        ? 20 * DAY_MS
        : bucket === "week"
          ? 3 * DAY_MS
          : DAY_MS;
  for (let t = since.getTime(); t <= until.getTime(); t += step) {
    const period = usagePeriod(new Date(t), asUsageBucket(bucket));
    if (seen.has(period.key)) continue;
    seen.add(period.key);
    keys.push(period);
  }
  // Always include "now".
  const now = usagePeriod(until, asUsageBucket(bucket));
  if (!seen.has(now.key)) keys.push(now);
  return keys;
}

/** Real conversation traffic — drafts are not messages yet. */
const COUNTED_MESSAGE_STATUSES = ["SENT", "RECEIVED", "RECORDED", "WAITING_AGENT", "APPROVED"] as const;

function isTelegramEmailMirror(channel: string, externalContext: string | null | undefined) {
  if (channel !== "EMAIL") return false;
  if (!externalContext) return false;
  try {
    const ctx = JSON.parse(externalContext) as { mirroredFrom?: string };
    return ctx.mirroredFrom === "TELEGRAM";
  } catch {
    return false;
  }
}

export async function buildSalesDashboard(opts: {
  bucket?: DashboardBucket;
  agentId?: string | null;
}) {
  const bucket = opts.bucket ?? "day";
  const agentId = opts.agentId?.trim() || null;
  const until = new Date();
  const since = new Date(Date.now() - (lookbackDays(bucket) - 1) * DAY_MS);
  // Align to Minsk midnight for the oldest day key.
  const oldestKey = dayKey(since);
  const sinceAligned = new Date(`${oldestKey}T00:00:00+03:00`);

  const playbookWhere = agentId ? { agentId } : {};
  const periodKeys = buildPeriodKeys(bucket, sinceAligned, until);
  const buckets = new Map(periodKeys.map((p) => [p.key, emptySales(p)]));

  const [crmMessages, clientChanges, usage, activeCommunicating, activeClients, agents] =
    await Promise.all([
      prisma.crmMessage.findMany({
        where: {
          createdAt: { gte: sinceAligned },
          status: { in: [...COUNTED_MESSAGE_STATUSES] },
          conversation: {
            lead: {
              playbook: playbookWhere,
            },
          },
        },
        select: {
          createdAt: true,
          direction: true,
          conversation: {
            select: {
              leadId: true,
              channel: true,
              externalContext: true,
            },
          },
        },
      }),
      prisma.leadFieldChange.findMany({
        where: {
          field: "stage",
          newValue: "CLIENT",
          createdAt: { gte: sinceAligned },
          lead: { playbook: playbookWhere },
        },
        select: { createdAt: true, leadId: true },
      }),
      prisma.usageRecord.findMany({
        where: {
          createdAt: { gte: sinceAligned },
          provider: { not: "yandex" },
          requestType: { startsWith: "crm_" },
          ...(agentId ? { agentId } : {}),
        },
        select: { createdAt: true },
      }),
      prisma.salesLead.count({
        where: {
          stage: "COMMUNICATING",
          playbook: playbookWhere,
        },
      }),
      prisma.salesLead.count({
        where: {
          stage: "CLIENT",
          playbook: playbookWhere,
        },
      }),
      prisma.agent.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        ...(agentId ? { where: { id: agentId } } : {}),
      }),
    ]);

  const allCommunicating = new Set<string>();
  const allClients = new Set<string>();

  for (const row of crmMessages) {
    if (isTelegramEmailMirror(row.conversation.channel, row.conversation.externalContext)) {
      continue;
    }
    const period = usagePeriod(row.createdAt, asUsageBucket(bucket));
    const slot = buckets.get(period.key);
    if (!slot) continue;
    const inbound = row.direction === "INBOUND";
    const outbound = row.direction === "OUTBOUND";
    if (inbound) slot.inbound += 1;
    if (outbound) slot.outbound += 1;
    if (inbound || outbound) {
      slot.messages += 1;
      // Active dialogue in this bucket = lead with real traffic (not current stage).
      slot.communicatingLeads.add(row.conversation.leadId);
      allCommunicating.add(row.conversation.leadId);
    }
  }

  for (const row of clientChanges) {
    const period = usagePeriod(row.createdAt, asUsageBucket(bucket));
    const slot = buckets.get(period.key);
    if (!slot) continue;
    // One lead counts once per bucket and once in overall totals.
    if (slot.clientLeads.has(row.leadId)) continue;
    slot.clientLeads.add(row.leadId);
    allClients.add(row.leadId);
  }

  for (const row of usage) {
    const period = usagePeriod(row.createdAt, asUsageBucket(bucket));
    const slot = buckets.get(period.key);
    if (!slot) continue;
    slot.workMinuteKeys.add(minuteKey(row.createdAt));
  }

  const series: SalesPoint[] = [...buckets.values()].map((slot) => ({
    key: slot.key,
    label: slot.label,
    inbound: slot.inbound,
    outbound: slot.outbound,
    communicating: slot.communicatingLeads.size,
    clients: slot.clientLeads.size,
    messages: slot.messages,
    workMinutes: slot.workMinuteKeys.size,
  }));

  // Messages/minutes add across buckets; unique people must not be summed by day.
  const totals: SalesTotals & { communicatingLive: number; clientsLive: number } = {
    inbound: series.reduce((sum, row) => sum + row.inbound, 0),
    outbound: series.reduce((sum, row) => sum + row.outbound, 0),
    messages: series.reduce((sum, row) => sum + row.messages, 0),
    workMinutes: series.reduce((sum, row) => sum + row.workMinutes, 0),
    communicating: allCommunicating.size,
    clients: allClients.size,
    communicatingLive: activeCommunicating,
    clientsLive: activeClients,
  };

  return {
    bucket,
    series,
    totals,
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
  };
}

export async function buildSupportDashboard(opts: {
  bucket?: DashboardBucket;
  agentId?: string | null;
}) {
  const bucket = opts.bucket ?? "day";
  const agentId = opts.agentId?.trim() || null;
  const until = new Date();
  const oldestKey = dayKey(new Date(Date.now() - (lookbackDays(bucket) - 1) * DAY_MS));
  const sinceAligned = new Date(`${oldestKey}T00:00:00+03:00`);
  const periodKeys = buildPeriodKeys(bucket, sinceAligned, until);

  const agents = await prisma.agent.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    ...(agentId ? { where: { id: agentId } } : {}),
  });
  const agentIds = agents.map((a) => a.id);
  if (!agentIds.length) {
    return { bucket, agents: [] as SupportAgentSeries[], totals: { inbound: 0 } };
  }

  const messages = await prisma.chatMessage.findMany({
    where: {
      createdAt: { gte: sinceAligned },
      role: "user",
      agentId: { in: agentIds },
    },
    select: { createdAt: true, agentId: true, sessionId: true },
  });

  type SupportSlot = { key: string; label: string; sessions: Set<string> };
  const byAgent = new Map<string, Map<string, SupportSlot>>();
  const allSessions = new Set<string>();
  for (const agent of agents) {
    const map = new Map(
      periodKeys.map((p) => [p.key, { ...p, sessions: new Set<string>() } satisfies SupportSlot]),
    );
    byAgent.set(agent.id, map);
  }

  for (const row of messages) {
    if (!row.agentId) continue;
    const map = byAgent.get(row.agentId);
    if (!map) continue;
    const period = usagePeriod(row.createdAt, asUsageBucket(bucket));
    const slot = map.get(period.key);
    if (!slot) continue;
    const session = row.sessionId?.trim() || `msg:${row.createdAt.toISOString()}`;
    slot.sessions.add(session);
    allSessions.add(`${row.agentId}:${session}`);
  }

  const series: SupportAgentSeries[] = agents.map((agent) => {
    const slots = [...(byAgent.get(agent.id)?.values() ?? [])];
    const agentSessions = new Set<string>();
    for (const slot of slots) {
      for (const session of slot.sessions) agentSessions.add(session);
    }
    return {
      agentId: agent.id,
      name: agent.name,
      totalInbound: agentSessions.size,
      points: slots.map((slot) => ({
        key: slot.key,
        label: slot.label,
        inbound: slot.sessions.size,
      })),
    };
  });

  return {
    bucket,
    agents: series,
    totals: {
      inbound: allSessions.size,
    },
  };
}

/** Human label for current Minsk calendar period of a given bucket. */
export function currentPeriodLabel(bucket: DashboardBucket) {
  return usagePeriod(new Date(), asUsageBucket(bucket)).label;
}

export function minskNowParts() {
  return minskParts(new Date());
}
