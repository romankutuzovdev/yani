import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, writeLog } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { agentEngine } from "@/agent/AgentEngine";
import { writeMemory } from "@/memory";

type Params = { params: Promise<{ id: string }> };

const chatSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().min(1).default("default"),
  stream: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return error("Unauthorized", 401);

  const limit = checkRateLimit(`chat:${session.id}:${id}`, 30);
  if (!limit.allowed) return error("Rate limit exceeded", 429);

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return error("Agent not found", 404);

  try {
    const body = chatSchema.parse(await req.json());

    await prisma.chatMessage.create({
      data: {
        agentId: id,
        sessionId: body.sessionId,
        role: "user",
        content: body.message,
      },
    });

    await writeMemory({
      agentId: id,
      content: `User: ${body.message}`,
      type: "SHORT_TERM",
      userId: session.id,
    });

    const result = await agentEngine.run({
      agentId: id,
      instruction: body.message,
      userId: session.id,
      sessionId: body.sessionId,
      limits: {
        maxIterations: Math.min(agent.maxIterations, 6),
        timeoutMs: agent.timeoutMs,
      },
    });

    await prisma.chatMessage.create({
      data: {
        agentId: id,
        sessionId: body.sessionId,
        role: "assistant",
        content: result.result || result.error || "No response",
        metadata: JSON.stringify({ success: result.success, iterations: result.iterations }),
      },
    });

    await writeLog({
      type: "chat",
      message: `Chat with ${agent.name}`,
      agentId: id,
      userId: session.id,
      meta: { success: result.success, iterations: result.iterations },
    });

    return json({
      reply: result.result || result.error,
      success: result.success,
      iterations: result.iterations,
      status: result.success ? "SUCCESS" : "ERROR",
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Chat failed", 500);
  }
}
