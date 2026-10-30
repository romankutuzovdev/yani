import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireOrg } from "@/lib/api";
import { requestUsage } from "@/lib/agentQuota";
import { formatPlanLine, formatSalesPlanLine } from "@/lib/plan";
import {
  buildSalesDashboard,
  buildSupportDashboard,
  type DashboardBucket,
} from "@/lib/dashboardMetrics";

function parseBucket(raw: string | null): DashboardBucket {
  if (raw === "week" || raw === "month" || raw === "year") return raw;
  return "day";
}

export async function GET(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;

  const bucket = parseBucket(req.nextUrl.searchParams.get("bucket"));

  const [agent, sales, support] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: org.orgAgentId },
      include: {
        character: { include: { assets: true } },
        skills: {
          orderBy: { sortOrder: "asc" },
          include: {
            skill: { select: { id: true, name: true, documentName: true } },
          },
        },
        _count: { select: { skills: true, tasks: true } },
      },
    }),
    buildSalesDashboard({ bucket, agentId: org.orgAgentId }),
    buildSupportDashboard({ bucket, agentId: org.orgAgentId }),
  ]);
  if (!agent) return error("Агент не найден", 404);

  const usage = requestUsage(agent);
  const profile = await prisma.user.findUnique({
    where: { id: org.id },
    select: {
      orgName: true,
      orgUnp: true,
      planName: true,
      planMonthlyPrice: true,
      salesEnabled: true,
      salesPlanName: true,
      salesPlanMonthlyPrice: true,
      salesPlaybookLimit: true,
      salesAgentLimit: true,
    },
  });
  const planName = profile?.planName ?? "";
  const planMonthlyPrice = profile?.planMonthlyPrice ?? 0;
  const salesEnabled = profile?.salesEnabled ?? false;
  const playbookUsed = salesEnabled
    ? await prisma.salesPlaybook.count({ where: { agentId: agent.id } })
    : 0;
  return json({
    agent: {
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      status: agent.status,
      requestsToday: usage.requestsToday,
      requestsMonth: usage.requestsMonth,
      monthlyRequestLimit: agent.monthlyRequestLimit,
      skills: agent._count.skills,
      tasks: agent._count.tasks,
      orgName: profile?.orgName ?? "",
      orgUnp: profile?.orgUnp ?? "",
      planName,
      planMonthlyPrice,
      planLine: formatPlanLine(planName, planMonthlyPrice, agent.monthlyRequestLimit),
      salesEnabled,
      salesPlanName: profile?.salesPlanName ?? "",
      salesPlanMonthlyPrice: profile?.salesPlanMonthlyPrice ?? 0,
      salesPlaybookLimit: profile?.salesPlaybookLimit ?? 0,
      salesAgentLimit: profile?.salesAgentLimit ?? 1,
      salesPlaybookUsed: playbookUsed,
      salesPlanLine: formatSalesPlanLine({
        enabled: salesEnabled,
        planName: profile?.salesPlanName ?? "",
        price: profile?.salesPlanMonthlyPrice ?? 0,
        playbookLimit: profile?.salesPlaybookLimit ?? 0,
        agentLimit: profile?.salesAgentLimit ?? 1,
      }),
      character: agent.character,
      skillRows: agent.skills.map((row) => row.skill),
    },
    sales,
    support,
  });
}
