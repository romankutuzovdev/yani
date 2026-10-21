import { prisma } from "@/lib/db";
import { writeCrmAudit } from "@/lib/crmAudit";

const STUCK_SENDING_MS = Number(process.env.CRM_STUCK_SENDING_MS ?? 5 * 60_000);

export async function reclaimStuckOutbox(now = new Date()) {
  const cutoff = new Date(now.getTime() - STUCK_SENDING_MS);
  // Prefer updatedAt, but also catch rows whose updatedAt was bumped by the claim write
  // and then the process died — use nextAttemptAt/createdAt as secondary signal.
  const stuck = await prisma.crmOutboxMessage.findMany({
    where: {
      status: "SENDING",
      OR: [
        { updatedAt: { lt: cutoff } },
        { nextAttemptAt: { lt: cutoff } },
        { createdAt: { lt: cutoff } },
      ],
    },
    take: 50,
    include: { connection: { select: { playbookId: true, type: true } } },
  });

  let reclaimed = 0;
  for (const row of stuck) {
    const updated = await prisma.crmOutboxMessage.updateMany({
      where: { id: row.id, status: "SENDING" },
      data: {
        status: "APPROVED",
        error: "Восстановлено после зависания SENDING",
        nextAttemptAt: now,
      },
    });
    if (!updated.count) continue;
    reclaimed += 1;
    await writeCrmAudit({
      playbookId: row.connection.playbookId,
      action: "outbox.reclaimed",
      entityType: "CrmOutboxMessage",
      entityId: row.id,
      summary: `Outbox ${row.id} возвращён в очередь после рестарта/зависания`,
      meta: { channel: row.connection.type },
    });
  }
  return reclaimed;
}

export async function moveFailedOutboxToDeadLetter(now = new Date()) {
  const failed = await prisma.crmOutboxMessage.findMany({
    where: { status: "FAILED" },
    take: 50,
    include: {
      connection: { select: { playbookId: true, type: true } },
      conversation: { select: { leadId: true } },
    },
  });

  let moved = 0;
  for (const row of failed) {
    await prisma.$transaction(async (tx) => {
      await tx.crmDeadLetter.create({
        data: {
          playbookId: row.connection.playbookId,
          connectionId: row.connectionId,
          outboxId: row.id,
          messageId: row.messageId,
          channel: row.connection.type,
          body: row.body.slice(0, 20_000),
          error: row.error.slice(0, 2000),
          attempts: row.attempts,
          payload: JSON.stringify({
            conversationId: row.conversationId,
            leadId: row.conversation.leadId,
            externalId: row.externalId,
          }),
        },
      });
      await tx.crmOutboxMessage.update({
        where: { id: row.id },
        data: { status: "DEAD" },
      });
    });
    moved += 1;
    await writeCrmAudit({
      playbookId: row.connection.playbookId,
      action: "outbox.dead_letter",
      entityType: "CrmOutboxMessage",
      entityId: row.id,
      summary: `Сообщение перенесено в dead-letter: ${row.error.slice(0, 120)}`,
      meta: { channel: row.connection.type, attempts: row.attempts },
    });
  }
  return moved;
}

export async function runCrmRecovery() {
  const reclaimed = await reclaimStuckOutbox();
  const deadLetters = await moveFailedOutboxToDeadLetter();
  return { reclaimed, deadLetters };
}
