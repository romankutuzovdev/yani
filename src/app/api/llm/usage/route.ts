import { prisma } from "@/lib/db";
import { error, json, requireAdmin } from "@/lib/api";
import { costUsd, formatUsd, getPricedModels } from "@/llm/pricing";
import type { LLMModelInfo } from "@/llm";

function startOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumCost(
  rows: Array<{ model: string; inputTokens: number; outputTokens: number }>,
  models: LLMModelInfo[],
) {
  return rows.reduce(
    (sum, row) => sum + costUsd(row.model, { inputTokens: row.inputTokens, outputTokens: row.outputTokens }, models),
    0,
  );
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const agentId = new URL(req.url).searchParams.get("agentId") || undefined;

  let models: LLMModelInfo[] = [];
  try {
    models = await getPricedModels();
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить цены", 502);
  }

  const where = agentId ? { agentId } : {};
  const [rows, agents] = await Promise.all([
    prisma.usageRecord.findMany({
      where,
      select: {
        agentId: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        createdAt: true,
      },
    }),
    prisma.agent.findMany({ select: { id: true, name: true, model: true } }),
  ]);

  const day = startOfDay();
  const month = startOfMonth();
  const todayRows = rows.filter((r) => r.createdAt >= day);
  const monthRows = rows.filter((r) => r.createdAt >= month);

  const byModelMap = new Map<
    string,
    { requests: number; inputTokens: number; outputTokens: number }
  >();
  const byAgentMap = new Map<string, { requests: number; cost: number }>();

  for (const row of rows) {
    const model = byModelMap.get(row.model) ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
    model.requests += 1;
    model.inputTokens += row.inputTokens;
    model.outputTokens += row.outputTokens;
    byModelMap.set(row.model, model);

    if (row.agentId) {
      const agent = byAgentMap.get(row.agentId) ?? { requests: 0, cost: 0 };
      agent.requests += 1;
      agent.cost += costUsd(row.model, row, models);
      byAgentMap.set(row.agentId, agent);
    }
  }

  const priceOf = (id: string) => models.find((m) => m.id === id);

  const byModel = Array.from(byModelMap.entries())
    .map(([model, stat]) => {
      const info = priceOf(model);
      const cost = costUsd(model, stat, models);
      return {
        model,
        displayName: info?.displayName ?? model,
        requests: stat.requests,
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        cost,
        costLabel: formatUsd(cost),
        inputUsdPerM: info?.pricing?.inputUsdPerM ?? null,
        outputUsdPerM: info?.pricing?.outputUsdPerM ?? null,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const agentName = new Map(agents.map((a) => [a.id, a]));
  const byAgent = Array.from(byAgentMap.entries())
    .map(([id, stat]) => {
      const info = agentName.get(id);
      return {
        agentId: id,
        name: info?.name ?? "Удалённый агент",
        currentModel: info?.model ?? "",
        requests: stat.requests,
        cost: stat.cost,
        costLabel: formatUsd(stat.cost),
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const totals = {
    all: sumCost(rows, models),
    today: sumCost(todayRows, models),
    month: sumCost(monthRows, models),
    requests: rows.length,
    todayRequests: todayRows.length,
    monthRequests: monthRows.length,
  };

  return json({
    currency: "USD",
    totals: {
      ...totals,
      allLabel: formatUsd(totals.all),
      todayLabel: formatUsd(totals.today),
      monthLabel: formatUsd(totals.month),
    },
    byModel,
    byAgent,
    prices: models
      .filter((m) => !m.isImage && m.pricing)
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        inputUsdPerM: m.pricing!.inputUsdPerM,
        outputUsdPerM: m.pricing!.outputUsdPerM,
      })),
  });
}
