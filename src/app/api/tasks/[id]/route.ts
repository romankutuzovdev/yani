import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { runTask } from "@/modules/tasks/runTask";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      agent: { select: { id: true, name: true, status: true } },
      executions: {
        orderBy: { startedAt: "desc" },
        include: { events: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!task) return error("Task not found", 404);
  return json({ task });
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  const task = await prisma.task.findUnique({ where: { id } });
  if (!task) return error("Task not found", 404);

  if (body.action === "cancel") {
    if (task.status === "RUNNING" || task.status === "PENDING") {
      await prisma.task.update({
        where: { id },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
      await prisma.taskExecution.updateMany({
        where: { taskId: id, status: "RUNNING" },
        data: { status: "CANCELLED", cancelled: true, finishedAt: new Date() },
      });
      await writeLog({
        type: "task",
        message: `Cancelled task: ${task.title}`,
        taskId: id,
        agentId: task.agentId,
        userId: admin.id,
      });
    }
    return json({ ok: true });
  }

  if (body.action === "run") {
    if (task.status === "RUNNING") return error("Task already running", 409);
    void runTask(id);
    await writeLog({
      type: "task",
      message: `Started task: ${task.title}`,
      taskId: id,
      agentId: task.agentId,
      userId: admin.id,
    });
    return json({ ok: true, started: true });
  }

  return error("Unknown action");
}
