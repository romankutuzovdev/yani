import { Prisma } from "@prisma/client";
import { Api, TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { prisma } from "@/lib/db";
import { runCrmRecovery } from "@/lib/crmRecovery";
import { decryptCrmSecret } from "@/lib/crmSecrets";
import { generateGroundedSalesDraft } from "@/lib/crmGrounding";
import { normalizeTelegram } from "@/lib/crm";
import {
  applyInboundAutomation,
  messageStatusForSendMode,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";
import {
  telegramGetUpdates,
  telegramSendMessage,
  type TelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";
import {
  createTelegramAccountClient,
  type TelegramAccountSecret,
} from "@/lib/telegramAccount";

let stopping = false;
const accountClients = new Map<string, TelegramClient>();
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseConfig(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function leadForTelegram(playbookId: string, message: TelegramMessage) {
  const chatId = String(message.chat.id);
  const username = normalizeTelegram(message.from?.username ?? message.chat.username ?? "");
  const identityFilters = [
    { type: "TELEGRAM_CHAT", value: chatId },
    ...(username ? [{ type: "TELEGRAM", value: username }] : []),
  ];
  const existing = await prisma.leadIdentity.findFirst({
    where: { playbookId, OR: identityFilters },
    select: { leadId: true },
  });
  if (existing) {
    return prisma.salesLead.findUniqueOrThrow({ where: { id: existing.leadId } });
  }

  const firstName = message.from?.first_name ?? message.chat.first_name ?? "";
  const lastName = message.from?.last_name ?? message.chat.last_name ?? "";
  return prisma.$transaction(async (tx) => {
    const lead = await tx.salesLead.create({
      data: {
        playbookId,
        displayName: `${firstName} ${lastName}`.trim(),
        telegram: username ? `@${username}` : "",
        stage: "COMMUNICATING",
        lastContactAt: new Date(),
      },
    });
    await tx.leadIdentity.createMany({
      data: identityFilters.map((identity) => ({
        playbookId,
        leadId: lead.id,
        ...identity,
        originalValue: identity.type === "TELEGRAM" ? `@${username}` : chatId,
      })),
    });
    return lead;
  });
}

async function prepareReply(connectionId: string, leadId: string, inboundText: string) {
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
        include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
      },
    },
  });
  if (!lead || lead.agentPaused || lead.playbook.status !== "RUNNING" || !lead.playbook.documents.length) return;

  const result = await generateGroundedSalesDraft({
    kind: "ANSWER",
    prompt: inboundText,
    playbook: lead.playbook,
    lead,
    documents: lead.playbook.documents,
    history: lead.conversations.flatMap((conversation) => conversation.messages),
    model: lead.playbook.agent.model,
  });
  const conversation = lead.conversations.find((item) => item.channel === "TELEGRAM");
  if (!conversation || !result.draft) return;

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const outboxStatus = outboxStatusForSendMode(lead.playbook.sendMode);
    const message = await tx.crmMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        status: messageStatusForSendMode(lead.playbook.sendMode),
        body: result.draft,
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
}

async function processUpdate(
  connection: {
    id: string;
    playbookId: string;
    playbook: { status: string };
  },
  update: TelegramUpdate,
) {
  try {
    await prisma.crmInboundEvent.create({
      data: {
        connectionId: connection.id,
        externalId: String(update.update_id),
        payload: JSON.stringify(update),
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return;
    throw cause;
  }

  const message = update.business_message ?? update.message;
  const businessConnectionId = update.business_message?.business_connection_id;
  const text = (message?.text ?? message?.caption ?? "").trim();
  if (!message || message.chat.type !== "private" || !text) {
    await prisma.crmInboundEvent.update({
      where: {
        connectionId_externalId: {
          connectionId: connection.id,
          externalId: String(update.update_id),
        },
      },
      data: { status: "IGNORED", processedAt: new Date() },
    });
    return;
  }

  try {
    const lead = await leadForTelegram(connection.playbookId, message);
    const now = new Date();
    const conversation = await prisma.crmConversation.upsert({
      where: { leadId_channel: { leadId: lead.id, channel: "TELEGRAM" } },
      create: {
        leadId: lead.id,
        channel: "TELEGRAM",
        externalThreadId: String(message.chat.id),
        externalContext: JSON.stringify({ businessConnectionId: businessConnectionId ?? "" }),
        lastMessageAt: now,
      },
      update: {
        externalThreadId: String(message.chat.id),
        ...(businessConnectionId
          ? { externalContext: JSON.stringify({ businessConnectionId }) }
          : {}),
        lastMessageAt: now,
      },
    });
    await prisma.$transaction([
      prisma.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          status: connection.playbook.status === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
          body: text,
          externalId: String(message.message_id),
        },
      }),
      prisma.salesLead.update({
        where: { id: lead.id },
        data: { stage: lead.stage === "NEW" ? "COMMUNICATING" : lead.stage, lastContactAt: now },
      }),
      prisma.crmInboundEvent.update({
        where: {
          connectionId_externalId: {
            connectionId: connection.id,
            externalId: String(update.update_id),
          },
        },
        data: { status: "PROCESSED", processedAt: now },
      }),
    ]);
    await applyInboundAutomation(lead.id, text);
    await prepareReply(connection.id, lead.id, text);
  } catch (cause) {
    await prisma.crmInboundEvent.update({
      where: {
        connectionId_externalId: {
          connectionId: connection.id,
          externalId: String(update.update_id),
        },
      },
      data: {
        status: "FAILED",
        error: cause instanceof Error ? cause.message.slice(0, 1000) : "Неизвестная ошибка",
        processedAt: new Date(),
      },
    });
  }
}

async function processAccountMessage(
  connection: { id: string; playbookId: string; playbook: { status: string } },
  event: NewMessageEvent,
) {
  if (!event.isPrivate) return;
  const text = event.message.text?.trim();
  if (!text || !event.message.senderId) return;
  const externalId = `${event.message.senderId.toString()}:${event.message.id}`;
  try {
    await prisma.crmInboundEvent.create({
      data: {
        connectionId: connection.id,
        externalId,
        payload: JSON.stringify({ messageId: event.message.id, text }),
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return;
    throw cause;
  }

  try {
    const sender = await event.message.getSender();
    if (!(sender instanceof Api.User)) throw new Error("Отправитель Telegram не является пользователем");
    const userId = sender.id.toString();
    const username = normalizeTelegram(sender.username ?? "");
    const filters = [
      { type: "TELEGRAM_USER", value: userId },
      ...(username ? [{ type: "TELEGRAM", value: username }] : []),
    ];
    const identity = await prisma.leadIdentity.findFirst({
      where: { playbookId: connection.playbookId, OR: filters },
      select: { leadId: true },
    });
    const lead = identity
      ? await prisma.salesLead.findUniqueOrThrow({ where: { id: identity.leadId } })
      : await prisma.$transaction(async (tx) => {
          const created = await tx.salesLead.create({
            data: {
              playbookId: connection.playbookId,
              displayName: `${sender.firstName ?? ""} ${sender.lastName ?? ""}`.trim(),
              telegram: username ? `@${username}` : "",
              stage: "COMMUNICATING",
              lastContactAt: new Date(),
            },
          });
          await tx.leadIdentity.createMany({
            data: filters.map((item) => ({
              playbookId: connection.playbookId,
              leadId: created.id,
              ...item,
              originalValue: item.type === "TELEGRAM" ? `@${username}` : userId,
            })),
          });
          return created;
        });
    const now = new Date();
    const conversation = await prisma.crmConversation.upsert({
      where: { leadId_channel: { leadId: lead.id, channel: "TELEGRAM" } },
      create: {
        leadId: lead.id,
        channel: "TELEGRAM",
        externalThreadId: username || userId,
        externalContext: JSON.stringify({ transport: "MTProto" }),
        lastMessageAt: now,
      },
      update: {
        externalThreadId: username || userId,
        externalContext: JSON.stringify({ transport: "MTProto" }),
        lastMessageAt: now,
      },
    });
    await prisma.$transaction([
      prisma.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          status: connection.playbook.status === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
          body: text,
          externalId: String(event.message.id),
        },
      }),
      prisma.salesLead.update({
        where: { id: lead.id },
        data: { stage: lead.stage === "NEW" ? "COMMUNICATING" : lead.stage, lastContactAt: now },
      }),
      prisma.crmInboundEvent.update({
        where: { connectionId_externalId: { connectionId: connection.id, externalId } },
        data: { status: "PROCESSED", processedAt: now },
      }),
    ]);
    await applyInboundAutomation(lead.id, text);
    await prepareReply(connection.id, lead.id, text);
  } catch (cause) {
    await prisma.crmInboundEvent.update({
      where: { connectionId_externalId: { connectionId: connection.id, externalId } },
      data: {
        status: "FAILED",
        error: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка MTProto",
        processedAt: new Date(),
      },
    });
  }
}

async function ensureAccountClient(connection: {
  id: string;
  playbookId: string;
  encryptedSecret: string;
  playbook: { status: string };
}) {
  const existing = accountClients.get(connection.id);
  if (existing) return existing;
  const secret = JSON.parse(decryptCrmSecret(connection.encryptedSecret)) as TelegramAccountSecret;
  const client = createTelegramAccountClient(secret);
  await client.connect();
  if (!(await client.checkAuthorization())) {
    await client.disconnect();
    throw new Error("Сессия Telegram-аккаунта истекла");
  }
  client.addEventHandler(
    (event) => void processAccountMessage(connection, event).catch((cause) => {
      console.error("[crm-telegram] account update:", cause instanceof Error ? cause.message : cause);
    }),
    new NewMessage({ incoming: true }),
  );
  accountClients.set(connection.id, client);
  return client;
}

async function syncAccountClients() {
  const connections = await prisma.crmChannelConnection.findMany({
    where: { type: "TELEGRAM_ACCOUNT", status: "CONNECTED" },
    include: { playbook: { select: { status: true } } },
  });
  const active = new Set(connections.map((connection) => connection.id));
  for (const [id, client] of accountClients) {
    if (!active.has(id)) {
      await client.disconnect();
      accountClients.delete(id);
    }
  }
  for (const connection of connections) {
    try {
      await ensureAccountClient(connection);
      await prisma.crmChannelConnection.update({
        where: { id: connection.id },
        data: { lastPolledAt: new Date(), lastError: "" },
      });
    } catch (cause) {
      await prisma.crmChannelConnection.update({
        where: { id: connection.id },
        data: {
          status: "ERROR",
          lastError: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка MTProto",
        },
      });
    }
  }
}

async function pollConnection(connection: {
  id: string;
  playbookId: string;
  encryptedSecret: string;
  config: string;
  playbook: { status: string };
}) {
  const token = decryptCrmSecret(connection.encryptedSecret);
  let config = parseConfig(connection.config);
  const offset = Number(config.offset ?? 0);
  try {
    const updates = await telegramGetUpdates(token, offset);
    let nextOffset = offset;
    for (const update of updates) {
      if (update.business_connection) {
        const current = (config.businessConnections ?? {}) as Record<string, unknown>;
        config = {
          ...config,
          businessConnections: {
            ...current,
            [update.business_connection.id]: update.business_connection,
          },
        };
      }
      await processUpdate(connection, update);
      nextOffset = Math.max(nextOffset, update.update_id + 1);
    }
    await prisma.crmChannelConnection.update({
      where: { id: connection.id },
      data: {
        config: JSON.stringify({ ...config, offset: nextOffset }),
        lastPolledAt: new Date(),
        lastError: "",
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Ошибка Telegram";
    await prisma.crmChannelConnection.update({
      where: { id: connection.id },
      data: {
        lastError: message.slice(0, 1000),
        status: /unauthorized|not found/i.test(message) ? "ERROR" : "CONNECTED",
      },
    });
  }
}

async function deliverApproved() {
  const rows = await prisma.crmOutboxMessage.findMany({
    where: {
      status: "APPROVED",
      nextAttemptAt: { lte: new Date() },
      attempts: { lt: 5 },
      connection: { type: { in: ["TELEGRAM", "TELEGRAM_ACCOUNT"] } },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      connection: true,
      conversation: { select: { externalThreadId: true, externalContext: true } },
    },
  });

  for (const row of rows) {
    const claimed = await prisma.crmOutboxMessage.updateMany({
      where: { id: row.id, status: "APPROVED" },
      data: { status: "SENDING" },
    });
    if (!claimed.count) continue;
    try {
      let sentExternalId = "";
      if (row.connection.type === "TELEGRAM_ACCOUNT") {
        const playbook = await prisma.salesPlaybook.findUniqueOrThrow({
          where: { id: row.connection.playbookId },
          select: { status: true },
        });
        const client = await ensureAccountClient({ ...row.connection, playbook });
        const sent = await client.sendMessage(row.conversation.externalThreadId, {
          message: row.body,
        });
        sentExternalId = String(sent.id);
      } else {
        const token = decryptCrmSecret(row.connection.encryptedSecret);
        const context = parseConfig(row.conversation.externalContext);
        const businessConnectionId =
          typeof context.businessConnectionId === "string" ? context.businessConnectionId : undefined;
        const sent = await telegramSendMessage(
          token,
          row.conversation.externalThreadId,
          row.body,
          businessConnectionId,
        );
        sentExternalId = String(sent.message_id);
      }
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            attempts: { increment: 1 },
            externalId: sentExternalId,
            sentAt: new Date(),
            error: "",
          },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: "SENT", externalId: sentExternalId },
        }),
      ]);
    } catch (cause) {
      const attempts = row.attempts + 1;
      const failed = attempts >= row.maxAttempts;
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: {
            status: failed ? "FAILED" : "APPROVED",
            attempts,
            nextAttemptAt: new Date(Date.now() + Math.min(300_000, 5_000 * 2 ** attempts)),
            error: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка отправки",
          },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: failed ? "FAILED" : "APPROVED" },
        }),
      ]);
    }
  }
}

async function main() {
  console.log("[crm-telegram] worker started");
  while (!stopping) {
    await runCrmRecovery();
    await syncAccountClients();
    await deliverApproved();
    const connections = await prisma.crmChannelConnection.findMany({
      where: { type: "TELEGRAM", status: "CONNECTED" },
      include: { playbook: { select: { status: true } } },
    });
    if (!connections.length) {
      await pause(2_000);
      continue;
    }
    for (const connection of connections) {
      if (stopping) break;
      await pollConnection(connection);
    }
  }
  for (const client of accountClients.values()) await client.disconnect();
  await prisma.$disconnect();
  console.log("[crm-telegram] worker stopped");
}

main().catch(async (cause) => {
  console.error("[crm-telegram] fatal:", cause instanceof Error ? cause.message : cause);
  await prisma.$disconnect();
  process.exit(1);
});
