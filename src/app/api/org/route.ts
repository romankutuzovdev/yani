import { prisma } from "@/lib/db";
import { error, json, requireOrg } from "@/lib/api";
import { requestUsage } from "@/lib/agentQuota";
import { formatPlanLine } from "@/lib/plan";

export async function GET() {
  const org = await requireOrg();
  if (org instanceof Response) return org;

  const agent = await prisma.agent.findUnique({
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
  });
  if (!agent) return error("Агент не найден", 404);

  const usage = requestUsage(agent);
  const profile = await prisma.user.findUnique({
    where: { id: org.id },
    select: { orgName: true, orgUnp: true, planName: true, planMonthlyPrice: true },
  });
  const planName = profile?.planName ?? "";
  const planMonthlyPrice = profile?.planMonthlyPrice ?? 0;
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
      character: agent.character,
      skillRows: agent.skills.map((row) => row.skill),
    },
  });
}
