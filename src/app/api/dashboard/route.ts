import { prisma } from "@/lib/db";
import { json, requireAdmin } from "@/lib/api";
import { formatUsd } from "@/llm/pricing";
import { placesForIps } from "@/lib/ipRegion";

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIT_DAYS = 14;
const TZ = "Europe/Minsk";

function dayKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "short" }).format(date);
}

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const oldestKey = dayKey(new Date(Date.now() - (VISIT_DAYS - 1) * DAY_MS));
  const since = new Date(`${oldestKey}T00:00:00+03:00`);

  const [agents, tasks, skills, tools, todayUsage, monthUsage, visits] = await Promise.all([
    prisma.agent.count(),
    prisma.task.count(),
    prisma.skill.count(),
    prisma.toolRegistry.count(),
    prisma.usageRecord.aggregate({
      where: { createdAt: { gte: startOfDay } },
      _sum: { totalTokens: true, estimatedCost: true },
      _count: true,
    }),
    prisma.usageRecord.aggregate({
      where: { createdAt: { gte: startOfMonth } },
      _sum: { totalTokens: true, estimatedCost: true },
      _count: true,
    }),
    prisma.visitorRequest.findMany({
      where: { createdAt: { gte: since } },
      select: { ip: true, createdAt: true },
    }),
  ]);

  const byDay = new Map<string, { requests: number; ips: Set<string> }>();
  for (let i = VISIT_DAYS - 1; i >= 0; i -= 1) {
    byDay.set(dayKey(new Date(Date.now() - i * DAY_MS)), { requests: 0, ips: new Set() });
  }
  const ipCounts = new Map<string, number>();
  for (const row of visits) {
    const key = dayKey(row.createdAt);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.requests += 1;
      bucket.ips.add(row.ip);
    }
    ipCounts.set(row.ip, (ipCounts.get(row.ip) ?? 0) + 1);
  }

  const places = await placesForIps([...ipCounts.keys()]);
  const regions = new Map<string, { label: string; requests: number; visitors: number }>();
  for (const [ip, count] of ipCounts) {
    const place = places.get(ip);
    const label = place?.label || "Не определено";
    const current = regions.get(label) ?? { label, requests: 0, visitors: 0 };
    current.requests += count;
    current.visitors += 1;
    regions.set(label, current);
  }

  return json({
    stats: {
      agents,
      tasks,
      skills,
      tools,
      todayRequests: todayUsage._count,
      todayTokens: todayUsage._sum.totalTokens ?? 0,
      monthlyRequests: monthUsage._count,
      monthlyTokens: monthUsage._sum.totalTokens ?? 0,
      todayCost: formatUsd(todayUsage._sum.estimatedCost ?? 0),
      monthCost: formatUsd(monthUsage._sum.estimatedCost ?? 0),
    },
    visitsByDay: [...byDay.entries()].map(([day, bucket]) => ({
      day,
      label: dayLabel(day),
      requests: bucket.requests,
      visitors: bucket.ips.size,
    })),
    visitsByRegion: [...regions.values()].sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label, "ru")),
  });
}
