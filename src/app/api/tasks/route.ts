import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { runTask } from "@/modules/tasks/runTask";

const taskSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  instruction: z.string().min(1),
  priority: z.number().int().optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  cronExpression: z.string().optional().nullable(),
  maxDurationMs: z.number().int().optional(),
  maxIterations: z.number().int().optional(),
  skillIds: z.array(z.string()).optional(),
  toolNames: z.array(z.string()).optional(),
  runImmediately: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? undefined;

  const tasks = await prisma.task.findMany({
    where: {
      ...(agentId ? { agentId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: {
      agent: { select: { id: true, name: true, status: true } },
      executions: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return json({ tasks });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;

  try {
    const body = taskSchema.parse(await req.json());
    const agent = await prisma.agent.findUnique({ where: { id: body.agentId } });
    if (!agent) return error("Agent not found", 404);

    if (body.cronExpression) {
      // TODO: BullMQ/cron scheduler — store expression now, runner in phase 2
    }

    const task = await prisma.task.create({
      data: {
        agentId: body.agentId,
        title: body.title,
        description: body.description ?? "",
        instruction: body.instruction,
        priority: body.priority ?? 0,
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        cronExpression: body.cronExpression ?? null,
        maxDurationMs: body.maxDurationMs ?? agent.timeoutMs,
        maxIterations: body.maxIterations ?? agent.maxIterations,
        skillIds: body.skillIds ?? [],
        toolNames: body.toolNames ?? [],
        status: body.runImmediately ? "RUNNING" : "PENDING",
        startedAt: body.runImmediately ? new Date() : null,
      },
    });

    await writeLog({
      type: "task",
      message: `Created task: ${task.title}`,
      agentId: task.agentId,
      taskId: task.id,
      userId: admin.id,
    });

    if (body.runImmediately) {
      void runTask(task.id);
    }

    return json({ task }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed to create task", 500);
  }
}
