import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { defaultLLMModel, listLLMModels } from "./index";
import type { LLMModelInfo, ModelPricing } from "./types";

const SETTINGS_FILE = path.join(process.cwd(), "prisma", "data", "llm-settings.json");

type UsageSlice = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
};

let priceCache: { at: number; models: LLMModelInfo[] } | null = null;

export function readDefaultModel(): string {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as { defaultModel?: string };
    if (raw.defaultModel?.trim()) return raw.defaultModel.trim();
  } catch {
    // file missing until the admin picks a model
  }
  return defaultLLMModel();
}

export function writeDefaultModel(model: string) {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  current.defaultModel = model.trim();
  writeFileSync(SETTINGS_FILE, JSON.stringify(current, null, 2));
}

export async function getPricedModels(): Promise<LLMModelInfo[]> {
  if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.models;
  const { models } = await listLLMModels("all");
  priceCache = { at: Date.now(), models };
  return models;
}

export function costUsd(modelId: string, usage: UsageSlice, models: LLMModelInfo[]): number {
  const pricing = models.find((m) => m.id === modelId)?.pricing;
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

export async function estimateUsd(modelId: string, usage: UsageSlice): Promise<number> {
  try {
    const models = await getPricedModels();
    return costUsd(modelId, usage, models);
  } catch {
    return 0;
  }
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "$0";
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatPerMillion(pricing?: ModelPricing): string {
  if (!pricing || (pricing.inputUsdPerM === 0 && pricing.outputUsdPerM === 0)) {
    if (pricing?.usdPerImage) return `$${pricing.usdPerImage.toFixed(3)} / картинка`;
    return "";
  }
  const inn = pricing.inputUsdPerM < 0.01 ? pricing.inputUsdPerM.toFixed(4) : pricing.inputUsdPerM.toFixed(2);
  const out = pricing.outputUsdPerM < 0.01 ? pricing.outputUsdPerM.toFixed(4) : pricing.outputUsdPerM.toFixed(2);
  return `$${inn} / $${out} за 1 млн`;
}
