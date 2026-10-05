import { prisma } from "@/lib/db";

const ZONE = "Europe/Minsk";

export function requestPeriodKeys(date = new Date()) {
  const dayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return { dayKey, monthKey: dayKey.slice(0, 7) };
}

export function requestUsage(agent: {
  requestCountDay: number;
  requestCountDayKey: string;
  requestCountMonth: number;
  requestCountMonthKey: string;
}) {
  const { dayKey, monthKey } = requestPeriodKeys();
  return {
    requestsToday: agent.requestCountDayKey === dayKey ? agent.requestCountDay : 0,
    requestsMonth: agent.requestCountMonthKey === monthKey ? agent.requestCountMonth : 0,
  };
}

/** Counts one public chat. Returns a refusal when the day or month limit is already spent. */
export async function takeAgentRequestSlot(agentId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      dailyRequestLimit: true,
      monthlyRequestLimit: true,
      requestCountDay: true,
      requestCountDayKey: true,
      requestCountMonth: true,
      requestCountMonthKey: true,
    },
  });
  if (!agent) return { ok: false, message: "Агент не найден." };

  const { dayKey, monthKey } = requestPeriodKeys();
  const today = agent.requestCountDayKey === dayKey ? agent.requestCountDay : 0;
  const month = agent.requestCountMonthKey === monthKey ? agent.requestCountMonth : 0;

  if (agent.monthlyRequestLimit > 0 && month >= agent.monthlyRequestLimit) {
    return { ok: false, message: "Лимит запросов на этот месяц исчерпан." };
  }
  if (agent.dailyRequestLimit > 0 && today >= agent.dailyRequestLimit) {
    return { ok: false, message: "Лимит запросов на сегодня исчерпан." };
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      requestCountDay: today + 1,
      requestCountDayKey: dayKey,
      requestCountMonth: month + 1,
      requestCountMonthKey: monthKey,
    },
  });
  return { ok: true };
}
