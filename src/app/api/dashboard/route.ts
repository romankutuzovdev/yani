import { prisma } from "@/lib/db";
import { json, requireAdmin } from "@/lib/api";
import { costUsd, formatUsd, getPricedModels } from "@/llm/pricing";
import type { LLMModelInfo } from "@/llm";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    agents,
    tasks,
    skills,
    tools,
    todayUsage,
    monthUsage,
    recentTasks,
    recentLogs,
    monthRows,
  ] = await Promise.all([
    prisma.agent.count(),
    prisma.task.count(),
    prisma.skill.count(),
    prisma.toolRegistry.count(),
    prisma.usageRecord.aggregate({
      where: { createdAt: { gte: startOfDay } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.usageRecord.aggregate({
      where: { createdAt: { gte: startOfMonth } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.task.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { name: true } } },
    }),
    prisma.systemLog.findMany({ take: 8, orderBy: { createdAt: "desc" } }),
    prisma.usageRecord.findMany({
      where: { createdAt: { gte: startOfMonth } },
      select: { model: true, inputTokens: true, outputTokens: true, createdAt: true },
    }),
  ]);

  let models: LLMModelInfo[] = [];
  try {
    models = await getPricedModels();
  } catch {
    models = [];
  }
  const spent = (from: Date) =>
    formatUsd(
      monthRows
        .filter((row) => row.createdAt >= from)
        .reduce(
          (sum, row) =>
            sum + costUsd(row.model, { inputTokens: row.inputTokens, outputTokens: row.outputTokens }, models),
          0,
        ),
    );

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
      todayCost: spent(startOfDay),
      monthCost: spent(startOfMonth),
    },
    recentTasks,
    recentLogs,
  });
}
