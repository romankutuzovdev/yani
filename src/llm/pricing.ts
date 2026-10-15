import { formatExact, formatUsd } from "@/lib/money";
import { defaultLLMModel, listLLMModels } from "./index";
import { readLLMSettings, writeLLMSettings } from "./runtimeSettings";
import type { LLMModelInfo, ModelPricing } from "./types";

export { formatUsd };

type UsageSlice = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

let priceCache: { at: number; models: LLMModelInfo[] } | null = null;

export function clearPricedModelsCache() {
  priceCache = null;
}

export function readDefaultModel(): string {
  const raw = readLLMSettings().defaultModel?.trim();
  if (raw) return raw;
  return defaultLLMModel();
}

export function writeDefaultModel(model: string) {
  writeLLMSettings({ defaultModel: model });
  priceCache = null;
}

export async function getPricedModels(): Promise<LLMModelInfo[]> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.models;
  const { models } = await listLLMModels("all");
  priceCache = { at: Date.now(), models };
  return models;
}

/**
 * vibecode chat streams report `deepseek-flash`, which is not in /v1/models.
 * The catalog id the product selects is `deepseek-v4-flash`.
 * Exact catalog ids always win, so gpt-5.5 and grok stay on their own rates.
 */
const UNPRICED_MODEL_ALIASES: Record<string, string> = {
  "deepseek-flash": "deepseek-v4-flash",
};

export function resolvePricedModelId(
  modelId: string,
  models: LLMModelInfo[],
  requestedId?: string,
): string {
  const reported = modelId.trim();
  const requested = (requestedId ?? "").trim();
  const known = (id: string) => id.length > 0 && models.some((m) => m.id === id);
  if (known(reported)) return reported;
  if (known(requested)) return requested;
  const alias = UNPRICED_MODEL_ALIASES[reported] ?? UNPRICED_MODEL_ALIASES[requested];
  if (alias && known(alias)) return alias;
  return reported || requested;
}

export function costUsd(
  modelId: string,
  usage: UsageSlice,
  models: LLMModelInfo[],
  requestedId?: string,
): number {
  const pricing = models.find((m) => m.id === resolvePricedModelId(modelId, models, requestedId))?.pricing;
  if (!pricing) return 0;
  return priceUsage(pricing, usage);
}

function priceUsage(pricing: ModelPricing, usage: UsageSlice): number {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = Math.max(0, usage.inputTokens - cached);
  const totalIn = usage.inputTokens;
  let inputRate = pricing.inputUsdPerM;
  let outputRate = pricing.outputUsdPerM;
  let cacheRate = pricing.cacheReadUsdPerM ?? pricing.inputUsdPerM;
  if (pricing.longContext && totalIn > pricing.longContext.thresholdTokens) {
    inputRate = pricing.longContext.inputUsdPerM;
    outputRate = pricing.longContext.outputUsdPerM;
    cacheRate = pricing.longContext.cacheReadUsdPerM ?? cacheRate;
  }
  return (fresh / 1_000_000) * inputRate + (cached / 1_000_000) * cacheRate + (usage.outputTokens / 1_000_000) * outputRate;
}

export async function estimateUsd(
  modelId: string,
  usage: UsageSlice,
  requestedId?: string,
): Promise<number> {
  try {
    const models = await getPricedModels();
    return costUsd(modelId, usage, models, requestedId);
  } catch {
    return 0;
  }
}

export function formatPerMillion(pricing?: ModelPricing): string {
  if (!pricing || (pricing.inputUsdPerM === 0 && pricing.outputUsdPerM === 0)) {
    if (pricing?.usdPerImage) return `$${formatExact(pricing.usdPerImage)} / картинка`;
    return "";
  }
  return `$${formatExact(pricing.inputUsdPerM)} / $${formatExact(pricing.outputUsdPerM)} за 1 млн`;
}
