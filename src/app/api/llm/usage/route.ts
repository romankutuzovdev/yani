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

  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId") || undefined;
  const range = url.searchParams.get("range") || "all";

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
        id: true,
        agentId: true,
        provider: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        requestType: true,
        createdAt: true,
      },
    }),
    prisma.agent.findMany({ select: { id: true, name: true, model: true } }),
  ]);

  const day = startOfDay();
  const month = startOfMonth();
  const todayRows = rows.filter((r) => r.createdAt >= day);
  const monthRows = rows.filter((r) => r.createdAt >= month);

  const since =
    range === "today" ? day : range === "month" ? month : null;
  const scoped = since ? rows.filter((row) => row.createdAt >= since) : rows;

  type Bucket = { requests: number; inputTokens: number; outputTokens: number; cost: number };
  const emptyBucket = (): Bucket => ({ requests: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
  const addBucket = (bucket: Bucket, row: (typeof rows)[number]) => {
    bucket.requests += 1;
    bucket.inputTokens += row.inputTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.cost += costUsd(row.model, row, models);
  };

  const byModelMap = new Map<string, Bucket>();
  const byAgentMap = new Map<string, Bucket>();
  const byPairMap = new Map<string, Bucket & { agentId: string; model: string }>();

  for (const row of scoped) {
    const model = byModelMap.get(row.model) ?? emptyBucket();
    addBucket(model, row);
    byModelMap.set(row.model, model);

    if (row.agentId) {
      const agent = byAgentMap.get(row.agentId) ?? emptyBucket();
      addBucket(agent, row);
      byAgentMap.set(row.agentId, agent);
      const pairKey = `${row.agentId}\0${row.model}`;
      const pair = byPairMap.get(pairKey) ?? { ...emptyBucket(), agentId: row.agentId, model: row.model };
      addBucket(pair, row);
      byPairMap.set(pairKey, pair);
    }
  }

  for (const agent of agents) {
    if (!byAgentMap.has(agent.id)) byAgentMap.set(agent.id, emptyBucket());
  }

  const priceOf = (id: string) => models.find((m) => m.id === id);

  const byModel = Array.from(byModelMap.entries())
    .map(([model, stat]) => {
      const info = priceOf(model);
      return {
        model,
        displayName: info?.displayName ?? model,
        requests: stat.requests,
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        cost: stat.cost,
        costLabel: formatUsd(stat.cost),
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
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        totalTokens: stat.inputTokens + stat.outputTokens,
        cost: stat.cost,
        costLabel: formatUsd(stat.cost),
      };
    })
    .sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);

  const byAgentModel = Array.from(byPairMap.values())
    .map((stat) => {
      const info = agentName.get(stat.agentId);
      const modelInfo = priceOf(stat.model);
      return {
        agentId: stat.agentId,
        agentName: info?.name ?? "Удалённый агент",
        model: stat.model,
        displayName: modelInfo?.displayName ?? stat.model,
        requests: stat.requests,
        inputTokens: stat.inputTokens,
        outputTokens: stat.outputTokens,
        totalTokens: stat.inputTokens + stat.outputTokens,
        costLabel: formatUsd(stat.cost),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const dayKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const dailyMap = new Map<string, Bucket>();
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    dailyMap.set(dayKey(date), emptyBucket());
  }
  for (const row of rows) {
    const key = dayKey(row.createdAt);
    const bucket = dailyMap.get(key);
    if (!bucket) continue;
    addBucket(bucket, row);
  }
  const daily = Array.from(dailyMap.entries()).map(([date, stat]) => ({
    date,
    requests: stat.requests,
    inputTokens: stat.inputTokens,
    outputTokens: stat.outputTokens,
    totalTokens: stat.inputTokens + stat.outputTokens,
    costLabel: formatUsd(stat.cost),
  }));

  const recent = [...scoped]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 40)
    .map((row) => {
      const info = row.agentId ? agentName.get(row.agentId) : undefined;
      const modelInfo = priceOf(row.model);
      const cost = costUsd(row.model, row, models);
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        agentId: row.agentId,
        agentName: info?.name ?? (row.agentId ? "Удалённый агент" : "Без агента"),
        model: row.model,
        displayName: modelInfo?.displayName ?? row.model,
        provider: row.provider,
        requestType: row.requestType,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens || row.inputTokens + row.outputTokens,
        costLabel: formatUsd(cost),
      };
    });

  const scopedTokens = scoped.reduce(
    (sum, row) => {
      sum.input += row.inputTokens;
      sum.output += row.outputTokens;
      return sum;
    },
    { input: 0, output: 0 },
  );

  const totals = {
    all: sumCost(rows, models),
    today: sumCost(todayRows, models),
    month: sumCost(monthRows, models),
    requests: rows.length,
    todayRequests: todayRows.length,
    monthRequests: monthRows.length,
    inputTokens: scopedTokens.input,
    outputTokens: scopedTokens.output,
    totalTokens: scopedTokens.input + scopedTokens.output,
    range,
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
    byAgentModel,
    daily,
    recent,
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
