export interface AgentContext {
  agentId: string;
  taskId?: string;
  executionId?: string;
  userId?: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, context: AgentContext): Promise<ToolResult>;
}

export function ok(output: unknown): ToolResult {
  return { success: true, output };
}

export function fail(error: string): ToolResult {
  return { success: false, output: null, error };
}
