import { prisma } from "@/lib/db";
import { agentEngine } from "@/agent/AgentEngine";
import { writeLog } from "@/lib/api";

export async function runTask(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return;

  const execution = await prisma.taskExecution.create({
    data: { taskId, status: "RUNNING" },
  });

  await prisma.task.update({
    where: { id: taskId },
    data: { status: "RUNNING", startedAt: new Date(), error: null },
  });

  const result = await agentEngine.run({
    agentId: task.agentId,
    instruction: task.instruction,
    taskId: task.id,
    executionId: execution.id,
    skillIds: task.skillIds,
    toolNames: task.toolNames,
    limits: {
      maxIterations: task.maxIterations,
      timeoutMs: task.maxDurationMs,
    },
  });

  await prisma.taskExecution.update({
    where: { id: execution.id },
    data: {
      status: result.cancelled ? "CANCELLED" : result.success ? "COMPLETED" : "FAILED",
      result: result.result,
      error: result.error,
      iterations: result.iterations,
      finishedAt: new Date(),
      cancelled: Boolean(result.cancelled),
      summary: result.success ? "Completed" : result.error ?? "Failed",
    },
  });

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: result.cancelled ? "CANCELLED" : result.success ? "COMPLETED" : "FAILED",
      result: result.result,
      error: result.error,
      finishedAt: new Date(),
    },
  });

  await writeLog({
    level: result.success ? "INFO" : "ERROR",
    type: "task_execution",
    message: result.success
      ? `Task completed: ${task.title}`
      : `Task failed: ${task.title} — ${result.error}`,
    agentId: task.agentId,
    taskId: task.id,
    meta: { iterations: result.iterations },
  });
}
