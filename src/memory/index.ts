import { prisma } from "@/lib/db";
import type { MemoryType } from "@prisma/client";
import { fail, ok, type AgentTool } from "@/tools/types";
import { registerTool } from "@/tools";

export interface MemoryWriteInput {
  agentId: string;
  content: string;
  type?: MemoryType;
  userId?: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeMemory(input: MemoryWriteInput) {
  return prisma.memory.create({
    data: {
      agentId: input.agentId,
      content: input.content,
      type: input.type ?? "SHORT_TERM",
      userId: input.userId,
      taskId: input.taskId,
      metadata: JSON.stringify(input.metadata ?? {}),
    },
  });
}

export async function searchMemory(opts: {
  agentId: string;
  query: string;
  limit?: number;
  type?: MemoryType;
  userId?: string;
}) {
  const limit = opts.limit ?? 8;
  // Simple keyword search for MVP — architecture ready for pgvector/Qdrant later
  const memories = await prisma.memory.findMany({
    where: {
      agentId: opts.agentId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
      content: { contains: opts.query },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (memories.length > 0) return memories;

  // Fallback: recent memories when query has no hits
  return prisma.memory.findMany({
    where: {
      agentId: opts.agentId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getRelevantMemory(opts: {
  agentId: string;
  query: string;
  userId?: string;
  limit?: number;
}) {
  const [shortTerm, longTerm, task, user] = await Promise.all([
    searchMemory({ ...opts, type: "SHORT_TERM", limit: 5 }),
    searchMemory({ ...opts, type: "LONG_TERM", limit: 3 }),
    searchMemory({ ...opts, type: "TASK", limit: 3 }),
    opts.userId
      ? searchMemory({ ...opts, type: "USER", limit: 3 })
      : Promise.resolve([]),
  ]);

  return {
    shortTerm,
    longTerm,
    task,
    user,
    agent: await searchMemory({ ...opts, type: "AGENT", limit: 3 }),
  };
}

export function formatMemoryForPrompt(memory: Awaited<ReturnType<typeof getRelevantMemory>>): string {
  const lines: string[] = [];
  const push = (label: string, items: { content: string; createdAt: Date }[]) => {
    if (!items.length) return;
    lines.push(`### ${label}`);
    for (const m of items) {
      lines.push(`- (${m.createdAt.toISOString()}) ${m.content}`);
    }
  };
  push("Short-term", memory.shortTerm);
  push("Long-term", memory.longTerm);
  push("Task", memory.task);
  push("User", memory.user);
  push("Agent", memory.agent);
  return lines.join("\n");
}

export const memorySearchTool: AgentTool = {
  name: "memory_search",
  description: "Search the agent's memory for relevant past information.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  async execute(input, context) {
    const data = input as { query?: string; limit?: number };
    if (!data.query) return fail("query is required");
    const results = await searchMemory({
      agentId: context.agentId,
      query: data.query,
      limit: data.limit ?? 5,
      userId: context.userId,
    });
    return ok(
      results.map((r) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        createdAt: r.createdAt,
      })),
    );
  },
};

export function registerMemoryTool() {
  registerTool(memorySearchTool);
}
