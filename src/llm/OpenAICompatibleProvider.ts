import type {
  LLMChunk,
  LLMModelInfo,
  LLMModelKind,
  LLMOptions,
  LLMProvider,
  LLMResponse,
  Message,
  ModelPricing,
  ModelRate,
} from "./types";

interface ChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string;
  delta?: {
    content?: string | null;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
}

interface ChatResponse {
  model: string;
  choices: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

export type OpenAICompatibleOptions = {
  name: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Env var name shown in missing-key errors */
  keyEnvName?: string;
};

/** OpenAI-compatible chat/completions client (DeepSeek, vibecode.moe, …). */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly keyEnvName: string;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name;
    this.apiKey = opts.apiKey ?? "";
    this.baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.defaultModel = opts.model ?? "gpt-5.5";
    this.keyEnvName = opts.keyEnvName ?? "API_KEY";
  }

  private ensureKey() {
    if (!this.apiKey) {
      throw new Error(`${this.keyEnvName} is not configured`);
    }
  }

  private buildBody(messages: Message[], options?: LLMOptions, stream = false) {
    const body: Record<string, unknown> = {
      model: options?.model ?? this.defaultModel,
      messages: messages.map((m) => ({
        role: m.role === "tool" ? "tool" : m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
      stream,
    };
    if (stream) body.stream_options = { include_usage: true };
    if (options?.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = "auto";
    }
    return body;
  }

  async listModels(kind: LLMModelKind = "chat"): Promise<LLMModelInfo[]> {
    this.ensureKey();
    const res = await fetch(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} models error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        display_name?: string;
        is_image?: boolean;
        owned_by?: string;
        pricing?: {
          usd_per_image?: number;
          input_usd_per_m?: number;
          output_usd_per_m?: number;
          cache_read_usd_per_m?: number;
          long_context?: {
            input_usd_per_m?: number;
            output_usd_per_m?: number;
            cache_read_usd_per_m?: number;
            threshold_tokens?: number;
          };
        };
      }>;
    };
    const rate = (raw?: {
      input_usd_per_m?: number;
      output_usd_per_m?: number;
      cache_read_usd_per_m?: number;
    }): ModelRate | undefined => {
      if (typeof raw?.input_usd_per_m !== "number" && typeof raw?.output_usd_per_m !== "number") {
        return undefined;
      }
      return {
        inputUsdPerM: raw.input_usd_per_m ?? 0,
        outputUsdPerM: raw.output_usd_per_m ?? 0,
        cacheReadUsdPerM: raw.cache_read_usd_per_m,
      };
    };
    const models = (data.data ?? [])
      .filter((m) => typeof m.id === "string" && m.id.trim())
      .map((m) => {
        const id = m.id!.trim();
        const base = rate(m.pricing);
        const long = m.pricing?.long_context;
        const longRate = rate(long);
        const pricing: ModelPricing | undefined = base
          ? {
              ...base,
              usdPerImage: m.pricing?.usd_per_image,
              longContext:
                longRate && typeof long?.threshold_tokens === "number"
                  ? { ...longRate, thresholdTokens: long.threshold_tokens }
                  : undefined,
            }
          : m.pricing?.usd_per_image
            ? {
                inputUsdPerM: 0,
                outputUsdPerM: 0,
                usdPerImage: m.pricing.usd_per_image,
              }
            : undefined;
        const isImage =
          m.is_image === true ||
          typeof m.pricing?.usd_per_image === "number" ||
          /image|banana/i.test(id);
        return {
          id,
          displayName: (m.display_name ?? id).trim() || id,
          isImage,
          ownedBy: m.owned_by,
          pricing,
        } satisfies LLMModelInfo;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "en"));

    if (kind === "image") return models.filter((m) => m.isImage);
    if (kind === "chat") return models.filter((m) => !m.isImage);
    return models;
  }

  async chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse> {
    this.ensureKey();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildBody(messages, options, false)),
      signal: options?.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${this.name} API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ChatResponse;
    const choice = data.choices?.[0];
    const toolCalls = choice?.message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      finishReason: choice?.finish_reason,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      model: data.model,
      provider: this.name,
    };
  }

  private async postChat(messages: Message[], options: LLMOptions | undefined, stream: boolean, includeUsage: boolean) {
    const body = this.buildBody(messages, options, stream);
    if (!includeUsage) delete body.stream_options;
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  }

  async *stream(messages: Message[], options?: LLMOptions): AsyncIterable<LLMChunk> {
    this.ensureKey();
    let res = await this.postChat(messages, options, true, true);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && /stream_options|include_usage/i.test(text)) {
        res = await this.postChat(messages, options, true, false);
      } else {
        throw new Error(`${this.name} stream error ${res.status}: ${text}`);
      }
    }
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`${this.name} stream error ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: LLMChunk["usage"];
    let model = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          if (toolAcc.size) {
            yield {
              toolCalls: Array.from(toolAcc.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([, call]) => call)
                .filter((call) => call.name),
            };
          }
          yield { done: true, usage, model: model || undefined };
          return;
        }
        try {
          const json = JSON.parse(payload) as ChatResponse & {
            usage?: ChatResponse["usage"] & {
              prompt_tokens_details?: { cached_tokens?: number };
            };
          };
          if (json.model) model = json.model;
          if (json.usage) {
            usage = {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
              totalTokens: json.usage.total_tokens ?? 0,
              cachedInputTokens: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
            };
          }
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) yield { content: delta.content };
          for (const call of delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const current = toolAcc.get(index) ?? { id: "", name: "", arguments: "" };
            if (call.id) current.id = call.id;
            if (call.function?.name) current.name += call.function.name;
            if (call.function?.arguments) current.arguments += call.function.arguments;
            toolAcc.set(index, current);
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }
    if (toolAcc.size) {
      yield {
        toolCalls: Array.from(toolAcc.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([, call]) => call)
          .filter((call) => call.name),
      };
    }
    yield { done: true, usage, model: model || undefined };
  }
}
