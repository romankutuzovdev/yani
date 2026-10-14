import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, requireAgentStaff, writeLog } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { agentEngine } from "@/agent/AgentEngine";
import { writeMemory } from "@/memory";
import { purgeExpiredChatMessages } from "@/lib/chatHistory";
import { ChatBusyError } from "@/lib/chatPool";
import { CHAT_UNAVAILABLE, toChatUserMessage } from "@/lib/chatUserError";

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
  if (session.role === "ORG") {
    const staff = await requireAgentStaff(id);
    if (staff instanceof Response) return staff;
  }

  const limit = checkRateLimit(`chat:${session.id}:${id}`, 30);
  if (!limit.allowed) return error("Rate limit exceeded", 429);

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return error("Agent not found", 404);

  try {
    const body = chatSchema.parse(await req.json());

    await purgeExpiredChatMessages().catch(() => undefined);
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

    const run = await agentEngine.run({
      agentId: id,
      instruction: body.message,
      userId: session.id,
      sessionId: body.sessionId,
      limits: {
        maxIterations: Math.min(agent.maxIterations, 6),
        timeoutMs: agent.timeoutMs,
      },
    });

    const reply = run.success
      ? run.result || CHAT_UNAVAILABLE
      : run.result?.trim() || toChatUserMessage(run.error);
    await prisma.chatMessage.create({
      data: {
        agentId: id,
        sessionId: body.sessionId,
        role: "assistant",
        content: reply,
        metadata: JSON.stringify({ success: run.success, iterations: run.iterations }),
      },
    });

    await writeLog({
      level: run.success ? "INFO" : "ERROR",
      type: run.success ? "chat" : "chat_error",
      message: run.success
        ? `Chat with ${agent.name}`
        : (run.detail || run.error || "Chat failed").slice(0, 4000),
      agentId: id,
      userId: session.id,
      meta: { success: run.success, iterations: run.iterations },
    });

    return json({
      reply,
      success: run.success,
      iterations: run.iterations,
      status: run.success ? "SUCCESS" : "ERROR",
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    if (e instanceof ChatBusyError) return error(e.message, 429, { code: "busy" });
    const raw = e instanceof Error ? e.message : "Chat failed";
    console.error(`[chat] admin ${id}: ${raw}`);
    await writeLog({
      level: "ERROR",
      type: "chat_error",
      message: raw.slice(0, 4000),
      agentId: id,
      userId: session.id,
    });
    return error(toChatUserMessage(raw), 500);
  }
}
