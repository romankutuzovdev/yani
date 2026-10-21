/**
 * Unified CRM worker: campaigns, outbox delivery hooks, recovery, optional BullMQ ticks.
 * Channel-specific polling still runs in crm-email-worker / crm-telegram-worker.
 */
import { prisma } from "@/lib/db";
import { processCampaignQueue } from "@/lib/crmCampaign";
import {
  ensureCrmRepeatableJobs,
  pingCrmRedis,
  startCrmQueueWorker,
  type CrmJobName,
} from "@/lib/crmQueue";
import { runCrmRecovery } from "@/lib/crmRecovery";

let stopping = false;

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(name: CrmJobName | "poll") {
  if (name === "crm.recover" || name === "poll") {
    const recovery = await runCrmRecovery();
    if (recovery.reclaimed || recovery.deadLetters) {
      console.log("[crm-worker] recovery", recovery);
    }
  }
  await processCampaignQueue();
}

async function main() {
  const redis = await pingCrmRedis();
  console.log(`[crm-worker] started redis=${redis.status}${redis.error ? ` (${redis.error})` : ""}`);

  const worker = startCrmQueueWorker(async (name) => {
    await tick(name);
  });
  if (worker) {
    await ensureCrmRepeatableJobs();
    console.log("[crm-worker] BullMQ repeatable jobs enabled");
  } else {
    console.log("[crm-worker] Redis unavailable — DB polling fallback");
  }

  while (!stopping) {
    if (!worker) {
      await tick("poll");
    }
    await pause(Number(process.env.CRM_WORKER_POLL_MS ?? 10_000));
  }

  await worker?.close();
  await prisma.$disconnect();
  console.log("[crm-worker] stopped");
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch(async (cause) => {
  console.error("[crm-worker] fatal:", cause instanceof Error ? cause.message : cause);
  await prisma.$disconnect();
  process.exit(1);
});
