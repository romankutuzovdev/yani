import type { LLMChunk, LLMOptions, LLMProvider, LLMResponse, Message } from "./types";

interface DeepSeekChatChoice {
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

interface DeepSeekChatResponse {
  model: string;
  choices: DeepSeekChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class DeepSeekProvider implements LLMProvider {
  readonly name = "deepseek";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(opts?: { apiKey?: string; baseUrl?: string; model?: string }) {
    this.apiKey = opts?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
    this.baseUrl = (opts?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.defaultModel = opts?.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  }

  private ensureKey() {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured");
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
    if (options?.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = "auto";
    }
    return body;
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
      throw new Error(`DeepSeek API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as DeepSeekChatResponse;
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
      },
      model: data.model,
      provider: this.name,
    };
  }

  async *stream(messages: Message[], options?: LLMOptions): AsyncIterable<LLMChunk> {
    this.ensureKey();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildBody(messages, options, true)),
      signal: options?.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`DeepSeek stream error ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
          yield { done: true };
          return;
        }
        try {
          const json = JSON.parse(payload) as DeepSeekChatResponse;
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            yield { content: delta.content };
          }
        } catch {
          // ignore malformed SSE chunks
        }
      }
    }
    yield { done: true };
  }
}
