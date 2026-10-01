import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkRateLimit, error, json, resolveApiKey, writeLog } from "@/lib/api";
import { runTask } from "@/modules/tasks/runTask";

type Params = { params: Promise<{ agentId: string }> };

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params;
  const origin = req.headers.get("origin");
  const key = await resolveApiKey(req.headers.get("authorization"));
  if (!key) return error("Invalid API key", 401);
  if (key.agentId && key.agentId !== agentId) return error("Forbidden", 403);
  if (!key.scopes.includes("tasks") && !key.scopes.includes("*")) {
    return error("Insufficient scope", 403);
  }
  const rl = checkRateLimit(`apikey:${key.id}:tasks`, key.rateLimit);
  if (!rl.allowed) return error("Rate limit exceeded", 429);

  try {
    const body = z
      .object({
        title: z.string().min(1),
        instruction: z.string().min(1),
        description: z.string().optional(),
        runImmediately: z.boolean().optional(),
      })
      .parse(await req.json());

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) return error("Agent not found", 404);

    const task = await prisma.task.create({
      data: {
        agentId,
        title: body.title,
        description: body.description ?? "",
        instruction: body.instruction,
        status: body.runImmediately === false ? "PENDING" : "RUNNING",
        startedAt: body.runImmediately === false ? null : new Date(),
      },
    });

    await writeLog({
      type: "api_task",
      message: `API created task ${task.title}`,
      agentId,
      taskId: task.id,
    });

    if (body.runImmediately !== false) {
      void runTask(task.id);
    }

    return json({ task }, { status: 201, headers: cors(origin) });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed", 500);
  }
}
