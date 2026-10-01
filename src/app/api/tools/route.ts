import { prisma } from "@/lib/db";
import { json, requireAdmin } from "@/lib/api";
import { ensureToolsRegistered, listTools } from "@/tools";
import { registerMemoryTool } from "@/memory";
import { asJsonObject } from "@/lib/utils";

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  ensureToolsRegistered();
  registerMemoryTool();

  for (const tool of listTools()) {
    await prisma.toolRegistry.upsert({
      where: { name: tool.name },
      update: {
        description: tool.description,
        inputSchema: JSON.stringify(tool.inputSchema),
      },
      create: {
        name: tool.name,
        description: tool.description,
        inputSchema: JSON.stringify(tool.inputSchema),
        builtIn: true,
      },
    });
  }

  const tools = await prisma.toolRegistry.findMany({ orderBy: { name: "asc" } });
  return json({
    tools: tools.map((t) => ({
      ...t,
      inputSchema: asJsonObject(t.inputSchema),
      config: asJsonObject(t.config),
    })),
  });
}
