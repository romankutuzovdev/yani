import type { LLMModelInfo, LLMModelKind, LLMProvider } from "./types";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

export type ProviderName = "vibecode" | "deepseek" | "openai" | "anthropic" | "gemini" | "local";

export function resolveLLMProviderName(): ProviderName {
  const raw = (process.env.LLM_PROVIDER ?? "vibecode").trim().toLowerCase();
  if (
    raw === "vibecode" ||
    raw === "deepseek" ||
    raw === "openai" ||
    raw === "anthropic" ||
    raw === "gemini" ||
    raw === "local"
  ) {
    return raw;
  }
  return "vibecode";
}

/** Default chat model for new agents / seed, based on active provider. */
export function defaultLLMModel(): string {
  const provider = resolveLLMProviderName();
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

/** Models available from the active OpenAI-compatible provider (vibecode / deepseek / openai). */
export async function listLLMModels(kind: LLMModelKind = "chat"): Promise<{
  provider: ProviderName;
  models: LLMModelInfo[];
}> {
  const provider = resolveLLMProviderName();
  const client = createLLMProvider(provider);
  if (!client.listModels) {
    return { provider, models: [] };
  }
  const models = await client.listModels(kind);
  return { provider, models };
}

export * from "./types";
export { DeepSeekProvider };
export { OpenAICompatibleProvider };
