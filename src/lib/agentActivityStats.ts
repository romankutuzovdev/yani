import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = "Europe/Minsk";

export type ActivityDay = {
  day: string;
  label: string;
  workMinutes: number;
  chats: number;
  messages: number;
  clients: number;
};

export type ActivityTotals = {
  workMinutes: number;
  chats: number;
  messages: number;
  clients: number;
};

export type ActivityReport = {
  days: number;
  daily: ActivityDay[];
  totals: ActivityTotals;
  agents: Array<{ id: string; name: string }>;
};

export function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
  }).format(date);
}

function minuteKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function emptyBuckets(days: number) {
  const map = new Map<
    string,
    {
      workMinutes: Set<string>;
      chats: Set<string>;
      messages: number;
      clients: number;
    }
  >();
  for (let i = days - 1; i >= 0; i -= 1) {
    map.set(dayKey(new Date(Date.now() - i * DAY_MS)), {
      workMinutes: new Set(),
      chats: new Set(),
      messages: 0,
      clients: 0,
    });
  }
  return map;
}

/** Daily mini-dashboard: people (unique chats), clients, work minutes, messages. */
export async function buildAgentActivityReport(opts: {
  days?: number;
  agentId?: string | null;
}): Promise<ActivityReport> {
  const days = Math.min(60, Math.max(7, opts.days ?? 14));
  const agentId = opts.agentId?.trim() || null;
  const oldestKey = dayKey(new Date(Date.now() - (days - 1) * DAY_MS));
  const since = new Date(`${oldestKey}T00:00:00+03:00`);
  const buckets = emptyBuckets(days);

  const agentFilter = agentId ? { agentId } : {};

  const [agents, usage, messages, clientChanges] = await Promise.all([
    prisma.agent.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      ...(agentId ? { where: { id: agentId } } : {}),
    }),
    prisma.usageRecord.findMany({
      where: {
        createdAt: { gte: since },
        provider: { not: "yandex" },
        ...(agentId ? { agentId } : {}),
      },
      select: { createdAt: true, agentId: true },
    }),
    prisma.chatMessage.findMany({
      where: {
        createdAt: { gte: since },
        role: "user",
        ...agentFilter,
      },
      select: { createdAt: true, sessionId: true, agentId: true },
    }),
    prisma.leadFieldChange.findMany({
      where: {
        field: "stage",
        newValue: "CLIENT",
        createdAt: { gte: since },
        ...(agentId
          ? { lead: { playbook: { agentId } } }
          : {}),
      },
      select: {
        createdAt: true,
        leadId: true,
        lead: { select: { playbook: { select: { agentId: true } } } },
      },
    }),
  ]);

  for (const row of usage) {
    const key = dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.workMinutes.add(minuteKey(row.createdAt));
  }

  for (const row of messages) {
    const key = dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.messages += 1;
    if (row.sessionId) bucket.chats.add(row.sessionId);
  }

  // One CLIENT conversion per lead per day (avoid double-counting edits).
  const clientSeen = new Set<string>();
  for (const row of clientChanges) {
    const key = dayKey(row.createdAt);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const dedupe = `${key}:${row.leadId}`;
    if (clientSeen.has(dedupe)) continue;
    clientSeen.add(dedupe);
    bucket.clients += 1;
  }

  const daily: ActivityDay[] = [...buckets.entries()].map(([day, bucket]) => ({
    day,
    label: dayLabel(day),
    workMinutes: bucket.workMinutes.size,
    chats: bucket.chats.size,
    messages: bucket.messages,
    clients: bucket.clients,
  }));

  const totals = daily.reduce<ActivityTotals>(
    (acc, row) => ({
      workMinutes: acc.workMinutes + row.workMinutes,
      chats: acc.chats + row.chats,
      messages: acc.messages + row.messages,
      clients: acc.clients + row.clients,
    }),
    { workMinutes: 0, chats: 0, messages: 0, clients: 0 },
  );

  return {
    days,
    daily,
    totals,
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
  };
}
