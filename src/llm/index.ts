import type { LLMModelInfo, LLMModelKind, LLMProvider } from "./types";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";
import { readLLMSettings } from "./runtimeSettings";

export type ProviderName =
  | "vibecode"
  | "hoster"
  | "deepseek"
  | "openai"
  | "anthropic"
  | "gemini"
  | "local";

const PROVIDERS = new Set<ProviderName>([
  "vibecode",
  "hoster",
  "deepseek",
  "openai",
  "anthropic",
  "gemini",
  "local",
]);

function asProviderName(raw?: string | null): ProviderName | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (PROVIDERS.has(value as ProviderName)) return value as ProviderName;
  return null;
}

export function resolveLLMProviderName(): ProviderName {
  // Admin override in llm-settings.json wins over .env
  const fromSettings = asProviderName(readLLMSettings().provider);
  if (fromSettings && fromSettings !== "anthropic" && fromSettings !== "gemini" && fromSettings !== "local") {
    return fromSettings;
  }
  const fromEnv = asProviderName(process.env.LLM_PROVIDER);
  if (fromEnv && fromEnv !== "anthropic" && fromEnv !== "gemini" && fromEnv !== "local") {
    return fromEnv;
  }
  return "vibecode";
}

/** hoster.by currently serves a single model. Everything else stays on vibecode. */
export function hosterModelId(): string {
  return (process.env.HOSTER_MODEL ?? "qwen3.8-27b").trim() || "qwen3.8-27b";
}

export function isHosterModel(modelId?: string | null): boolean {
  const id = (modelId ?? "").trim();
  return id.length > 0 && id === hosterModelId();
}

/**
 * Route by model id, not by the admin default.
 * qwen on hoster; gpt/gemini/grok/deepseek and the rest on vibecode
 * even when the active provider is hoster.
 */
export function providerForModel(modelId?: string | null): ProviderName {
  const id = (modelId ?? "").trim();
  if (isHosterModel(id)) return "hoster";
  const active = resolveLLMProviderName();
  if (!id) return active;
  if (active === "hoster") return "vibecode";
  return active;
}

/** Default chat model for new agents / seed, based on active provider. */
export function defaultLLMModel(): string {
  const provider = resolveLLMProviderName();
  if (provider === "hoster") {
    return process.env.HOSTER_MODEL ?? process.env.LLM_MODEL ?? "qwen3.8-27b";
  }
  if (provider === "vibecode") {
    return process.env.VIBECODE_MODEL ?? process.env.LLM_MODEL ?? "gpt-5.5";
  }
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_MODEL ?? process.env.LLM_MODEL ?? "deepseek-chat";
  }
  return process.env.LLM_MODEL ?? "gpt-5.5";
}

export function createLLMProvider(name: ProviderName = resolveLLMProviderName()): LLMProvider {
  switch (name) {
    case "vibecode":
      return new OpenAICompatibleProvider({
        name: "vibecode",
        apiKey: process.env.VIBECODE_API_KEY ?? "",
        baseUrl: process.env.VIBECODE_BASE_URL ?? "https://vibecode.moe/v1",
        model: process.env.VIBECODE_MODEL ?? "gpt-5.5",
        keyEnvName: "VIBECODE_API_KEY",
      });
    case "hoster":
      return new OpenAICompatibleProvider({
        name: "hoster",
        apiKey: process.env.HOSTER_API_KEY ?? "",
        baseUrl: process.env.HOSTER_BASE_URL ?? "https://ai.hoster.by/v1",
        model: process.env.HOSTER_MODEL ?? "qwen3.8-27b",
        keyEnvName: "HOSTER_API_KEY",
      });
    case "deepseek":
      return new DeepSeekProvider();
    case "openai":
      return new OpenAICompatibleProvider({
        name: "openai",
        apiKey: process.env.OPENAI_API_KEY ?? "",
        baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        keyEnvName: "OPENAI_API_KEY",
      });
    case "anthropic":
    case "gemini":
    case "local":
      throw new Error(`LLM provider "${name}" is not implemented yet`);
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

/** Vibecode catalog plus hoster model, so both stay selectable after a provider switch. */
export async function listLLMModels(kind: LLMModelKind = "chat"): Promise<{
  provider: ProviderName;
  models: LLMModelInfo[];
}> {
  const provider = resolveLLMProviderName();
  const names: ProviderName[] = [];
  for (const name of [provider, "vibecode", "hoster"] as const) {
    if (!names.includes(name)) names.push(name);
  }

  const models: LLMModelInfo[] = [];
  const seen = new Set<string>();
  let lastError: unknown;

  for (const name of names) {
    try {
      const client = createLLMProvider(name);
      if (!client.listModels) continue;
      const list = await client.listModels(kind);
      for (const model of list) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(
          name === "hoster"
            ? { ...model, displayName: `${model.displayName} · hoster` }
            : model,
        );
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (!models.length && lastError) throw lastError;
  return { provider, models };
}

export * from "./types";
export { DeepSeekProvider };
export { OpenAICompatibleProvider };
