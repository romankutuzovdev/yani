import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptCrmSecret } from "@/lib/crmSecrets";
import { generateGroundedSalesDraft } from "@/lib/crmGrounding";
import { messageStatusForSendMode, outboxStatusForSendMode } from "@/lib/crmAutomation";
import { detectUrgentNeed, flagLeadUrgent } from "@/lib/crmDialogExtras";
import { instagramSendText } from "@/lib/instagram";

type InstagramSecret = { accessToken: string; igUserId: string; host?: "instagram" | "facebook" };

type IncomingInstagramMessage = {
  senderId: string;
  recipientId: string;
  mid: string;
  text: string;
};

function parseConfig(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function secretOf(raw: string): InstagramSecret | null {
  try {
    const parsed = JSON.parse(decryptCrmSecret(raw)) as InstagramSecret;
    if (!parsed.accessToken || !parsed.igUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readInstagramMessages(payload: unknown): IncomingInstagramMessage[] {
  const body = payload as {
    entry?: Array<{
      id?: string;
      messaging?: Array<{
        sender?: { id?: string };
        recipient?: { id?: string };
        message?: { mid?: string; text?: string; is_echo?: boolean };
      }>;
    }>;
  };
  const found: IncomingInstagramMessage[] = [];
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim() || "";
      const senderId = event.sender?.id || "";
      const recipientId = event.recipient?.id || entry.id || "";
      if (!text || !senderId || !event.message?.mid || event.message.is_echo) continue;
      if (senderId === recipientId || senderId === entry.id) continue;
      found.push({ senderId, recipientId, mid: event.message.mid, text });
    }
  }
  return found;
}

async function connectionForRecipient(recipientId: string) {
  const connections = await prisma.crmChannelConnection.findMany({
    where: { type: "INSTAGRAM", status: "CONNECTED" },
    include: { playbook: { select: { id: true, status: true, agentId: true, sendMode: true } } },
  });
  return (
    connections.find((connection) => {
      const config = parseConfig(connection.config);
      return config.igUserId === recipientId || config.igScopedId === recipientId;
    }) ?? null
  );
}

export async function ingestInstagramPayload(payload: unknown) {
  const messages = readInstagramMessages(payload);
  for (const message of messages) {
    const connection = await connectionForRecipient(message.recipientId);
    if (!connection) {
      console.log(`[crm-instagram] no connection for recipient=${message.recipientId}`);
      continue;
    }
    try {
      await prisma.crmInboundEvent.create({
        data: {
          connectionId: connection.id,
          externalId: message.mid,
          payload: JSON.stringify(message),
        },
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") continue;
      throw cause;
    }
    await acceptInstagramMessage(connection, message);
  }
}

async function acceptInstagramMessage(
  connection: {
    id: string;
    playbookId: string;
    playbook: { status: string; agentId: string; sendMode: string };
  },
  message: IncomingInstagramMessage,
) {
  const identity = await prisma.leadIdentity.findUnique({
    where: {
      playbookId_type_value: {
        playbookId: connection.playbookId,
        type: "INSTAGRAM",
        value: message.senderId,
      },
    },
    select: { leadId: true },
  });
  const now = new Date();
  const lead = identity
    ? await prisma.salesLead.findUniqueOrThrow({ where: { id: identity.leadId } })
    : await prisma.$transaction(async (tx) => {
        const created = await tx.salesLead.create({
          data: {
            playbookId: connection.playbookId,
            displayName: `Instagram ${message.senderId.slice(-6)}`,
            stage: "COMMUNICATING",
            lastContactAt: now,
          },
        });
        await tx.leadIdentity.create({
          data: {
            playbookId: connection.playbookId,
            leadId: created.id,
            type: "INSTAGRAM",
            value: message.senderId,
            originalValue: message.senderId,
          },
        });
        return created;
      });

  const conversation = await prisma.crmConversation.upsert({
    where: { leadId_channel: { leadId: lead.id, channel: "INSTAGRAM" } },
    create: {
      leadId: lead.id,
      channel: "INSTAGRAM",
      externalThreadId: message.senderId,
      externalContext: JSON.stringify({ recipientId: message.recipientId }),
      lastMessageAt: now,
    },
    update: { externalThreadId: message.senderId, lastMessageAt: now },
  });

  await prisma.$transaction([
    prisma.crmMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        status: connection.playbook.status === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
        body: message.text,
        externalId: message.mid,
      },
    }),
    prisma.salesLead.update({
      where: { id: lead.id },
      data: { stage: lead.stage === "NEW" ? "COMMUNICATING" : lead.stage, lastContactAt: now },
    }),
    prisma.crmInboundEvent.update({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: message.mid } },
      data: { status: "PROCESSED", processedAt: now },
    }),
  ]);

  const urgent = detectUrgentNeed(message.text);
  if (urgent && !lead.urgentAt) {
    await flagLeadUrgent({
      playbookId: connection.playbookId,
      agentId: connection.playbook.agentId,
      leadId: lead.id,
      reason: urgent,
      snippet: message.text,
    });
  }

  if (connection.playbook.status !== "RUNNING" || lead.agentPaused) return;
  await queueInstagramReply(connection.id, lead.id, message.text);
}

/** Replays webhook events that were stored but not turned into a card yet. */
export async function resumeInstagramInbound() {
  const pending = await prisma.crmInboundEvent.findMany({
    where: { status: "RECEIVED", connection: { type: "INSTAGRAM" } },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      connection: {
        include: { playbook: { select: { id: true, status: true, agentId: true, sendMode: true } } },
      },
    },
  });
  for (const event of pending) {
    let message: IncomingInstagramMessage;
    try {
      message = JSON.parse(event.payload) as IncomingInstagramMessage;
    } catch {
      continue;
    }
    if (!message.mid || !message.senderId || !message.text) continue;
    const existing = await prisma.crmMessage.findFirst({
      where: { externalId: message.mid },
      select: { id: true },
    });
    if (existing) {
      await prisma.crmInboundEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
      continue;
    }
    await acceptInstagramMessage(
      {
        id: event.connection.id,
        playbookId: event.connection.playbookId,
        playbook: event.connection.playbook,
      },
      message,
    );
  }
}

async function queueInstagramReply(connectionId: string, leadId: string, inboundText: string) {
  const lead = await prisma.salesLead.findUnique({
    where: { id: leadId },
    include: {
      playbook: {
        include: {
          documents: { where: { status: "READY" }, orderBy: { sortOrder: "asc" } },
          agent: { select: { model: true } },
        },
      },
      conversations: {
        orderBy: { lastMessageAt: "asc" },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
      },
    },
  });
  const conversation = lead?.conversations.find((item) => item.channel === "INSTAGRAM");
  if (!lead || !conversation || lead.agentPaused || lead.playbook.status !== "RUNNING") return;

  const result = await generateGroundedSalesDraft({
    kind: "ANSWER",
    prompt: inboundText,
    playbook: lead.playbook,
    lead,
    documents: lead.playbook.documents,
    history: lead.conversations.flatMap((item) => item.messages),
    model: lead.playbook.agent.model,
  });
  if (!result.draft?.trim()) return;

  const now = new Date();
  const outboxStatus = outboxStatusForSendMode(lead.playbook.sendMode);
  await prisma.$transaction(async (tx) => {
    const message = await tx.crmMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        status: messageStatusForSendMode(lead.playbook.sendMode),
        body: result.draft,
        attachments: "[]",
      },
    });
    await tx.crmOutboxMessage.create({
      data: {
        connectionId,
        conversationId: conversation.id,
        messageId: message.id,
        body: result.draft,
        status: outboxStatus,
        approvedAt: outboxStatus === "APPROVED" ? now : null,
        nextAttemptAt: now,
      },
    });
  });
  if (outboxStatus === "APPROVED") await deliverInstagramOutbox();
}

export async function deliverInstagramOutbox() {
  const rows = await prisma.crmOutboxMessage.findMany({
    where: {
      status: "APPROVED",
      nextAttemptAt: { lte: new Date() },
      attempts: { lt: 5 },
      connection: { type: "INSTAGRAM", status: "CONNECTED" },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    include: {
      connection: true,
      conversation: { select: { externalThreadId: true } },
    },
  });

  for (const row of rows) {
    const claimed = await prisma.crmOutboxMessage.updateMany({
      where: { id: row.id, status: "APPROVED" },
      data: { status: "SENDING" },
    });
    if (!claimed.count) continue;
    const secret = secretOf(row.connection.encryptedSecret);
    const threadId = row.conversation.externalThreadId;
    if (!secret || !threadId) {
      await prisma.crmOutboxMessage.update({
        where: { id: row.id },
        data: { status: "FAILED", error: "Нет токена Instagram или id диалога", attempts: { increment: 1 } },
      });
      continue;
    }
    try {
      const externalId = await instagramSendText(
        secret.accessToken,
        secret.igUserId,
        threadId,
        row.body,
        secret.host,
      );
      const now = new Date();
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: { status: "SENT", externalId, sentAt: now, error: "", attempts: { increment: 1 } },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: "SENT", externalId },
        }),
      ]);
    } catch (cause) {
      const error = cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка Instagram";
      const attempts = row.attempts + 1;
      await prisma.crmOutboxMessage.update({
        where: { id: row.id },
        data: {
          status: attempts >= row.maxAttempts ? "FAILED" : "APPROVED",
          error,
          attempts,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      console.error("[crm-instagram] send failed:", error);
    }
  }
}
