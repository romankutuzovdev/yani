import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

/** @deprecated Prefer createLLMProvider("deepseek") — kept for tests/compat. */
export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string }) {
    super({
      name: "deepseek",
      apiKey: opts?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      baseUrl: opts?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model: opts?.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
      keyEnvName: "DEEPSEEK_API_KEY",
    });
  }
}
