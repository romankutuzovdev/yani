import type { LLMProvider } from "./types";
import { DeepSeekProvider } from "./DeepSeekProvider";

export type ProviderName = "deepseek" | "openai" | "anthropic" | "gemini" | "local";

export function createLLMProvider(name: ProviderName = "deepseek"): LLMProvider {
  switch (name) {
    case "deepseek":
      return new DeepSeekProvider();
    case "openai":
    case "anthropic":
    case "gemini":
    case "local":
      // TODO: implement additional providers
      throw new Error(`LLM provider "${name}" is not implemented yet`);
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}

export * from "./types";
export { DeepSeekProvider };
