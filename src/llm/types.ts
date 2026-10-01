export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMToolDefinition[];
  signal?: AbortSignal;
}

export interface LLMToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

export interface LLMChunk {
  content?: string;
  toolCalls?: Partial<LLMToolCall>[];
  done?: boolean;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], options?: LLMOptions): Promise<LLMResponse>;
  stream(messages: Message[], options?: LLMOptions): AsyncIterable<LLMChunk>;
}
