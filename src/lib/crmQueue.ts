import { Queue, Worker, type JobsOptions } from "bullmq";
import {
  getCrmRedis,
  isCrmRedisDisabled,
  markCrmRedisDisabled,
  pingCrmRedis,
} from "@/lib/crmRedis";

export type CrmJobName = "crm.tick" | "crm.recover";

let queue: Queue | null | undefined;

export { pingCrmRedis } from "@/lib/crmRedis";

export function getCrmQueue() {
  if (queue !== undefined) return queue;
  if (isCrmRedisDisabled()) {
    queue = null;
    return null;
  }
  const redis = getCrmRedis();
  if (!redis) {
    queue = null;
    return null;
  }
  queue = new Queue("yani-crm", {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    },
  });
  return queue;
}

export async function enqueueCrmJob(
  name: CrmJobName,
  data: Record<string, unknown> = {},
  opts?: JobsOptions,
) {
  const ping = await pingCrmRedis();
  if (ping.status !== "ok") {
    return { queued: false as const, reason: ping.error || "queue unavailable" };
  }
  const q = getCrmQueue();
  if (!q) return { queued: false as const, reason: "queue unavailable" };
  const job = await q.add(name, data, opts);
  return { queued: true as const, jobId: job.id };
}

export function startCrmQueueWorker(handler: (name: CrmJobName) => Promise<void>) {
  if (isCrmRedisDisabled()) return null;
  const redis = getCrmRedis();
  if (!redis) return null;
  try {
    const worker = new Worker(
      "yani-crm",
      async (job) => {
        await handler(job.name as CrmJobName);
      },
      { connection: redis, concurrency: 1 },
    );
    worker.on("failed", (job, err) => {
      console.error(`[crm-queue] job ${job?.name} failed:`, err.message);
    });
    return worker;
  } catch (cause) {
    markCrmRedisDisabled(cause instanceof Error ? cause.message : "worker init failed");
    return null;
  }
}

export async function ensureCrmRepeatableJobs() {
  const ping = await pingCrmRedis();
  if (ping.status !== "ok") return false;
  const q = getCrmQueue();
  if (!q) return false;
  await q.add(
    "crm.tick",
    {},
    {
      repeat: { every: Number(process.env.CRM_QUEUE_TICK_MS ?? 10_000) },
      jobId: "crm-tick",
    },
  );
  await q.add(
    "crm.recover",
    {},
    {
      repeat: { every: Number(process.env.CRM_QUEUE_RECOVER_MS ?? 60_000) },
      jobId: "crm-recover",
    },
  );
  return true;
}
