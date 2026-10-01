import type { AgentTool } from "./types";
import { calculatorTool, datetimeTool, httpRequestTool, webSearchTool } from "./builtin";

const registry = new Map<string, AgentTool>();

export function registerTool(tool: AgentTool) {
  registry.set(tool.name, tool);
}

export function getTool(name: string): AgentTool | undefined {
  return registry.get(name);
}

export function listTools(): AgentTool[] {
  return Array.from(registry.values());
}

export function getToolsByNames(names: string[]): AgentTool[] {
  return names.map((n) => registry.get(n)).filter((t): t is AgentTool => Boolean(t));
}

export function registerBuiltinTools() {
  for (const tool of [webSearchTool, httpRequestTool, calculatorTool, datetimeTool]) {
    registerTool(tool);
  }
}

// memory_search is registered lazily from memory module to avoid circular imports
export function ensureToolsRegistered() {
  if (registry.size === 0) {
    registerBuiltinTools();
  }
}

export * from "./types";
export { calculatorTool, datetimeTool, httpRequestTool, webSearchTool };
