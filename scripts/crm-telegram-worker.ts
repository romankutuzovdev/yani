import { Prisma } from "@prisma/client";
import { statSync } from "fs";
import { Api, TelegramClient } from "telegram";
import { CustomFile } from "telegram/client/uploads";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { prisma } from "@/lib/db";
import { runCrmRecovery } from "@/lib/crmRecovery";
import { decryptCrmSecret } from "@/lib/crmSecrets";
import { generateGroundedSalesDraft } from "@/lib/crmGrounding";
import { normalizeEmail, normalizeTelegram } from "@/lib/crm";
import {
  applyInboundAutomation,
  messageStatusForSendMode,
  nextOutboundMorning,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";
import {
  telegramDownloadFile,
  telegramGetUpdates,
  telegramSendChatAction,
  telegramSendDocumentFile,
  telegramSendMessage,
  telegramSendPhotoFile,
  type TelegramMessage,
  type TelegramUpdate,
} from "@/lib/telegram";
import { crmUploadAbsolutePath, isCrmImageMime, outboundAttachmentName, type CrmAttachment } from "@/lib/crmMedia";
import {
  buildInboundPromptWithMedia,
  extractInboundMediaText,
  playbookWantsInboundDocAnalysis,
  saveInboundTelegramFile,
  type InboundMediaFile,
} from "@/lib/crmInboundMedia";
import {
  createTelegramAccountClient,
  type TelegramAccountSecret,
} from "@/lib/telegramAccount";
import {
  clientAskedEmailDelivery,
  detectUrgentNeed,
  extractEmailFromText,
  flagLeadUrgent,
  sendEmailMirrorNow,
  withEmailSendStatus,
} from "@/lib/crmDialogExtras";

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

async function collectBotInboundFiles(token: string, message: TelegramMessage): Promise<InboundMediaFile[]> {
  const files: InboundMediaFile[] = [];
  if (message.document?.file_id) {
    const downloaded = await telegramDownloadFile(token, message.document.file_id);
    files.push({
      buffer: downloaded.buffer,
      fileName: message.document.file_name || downloaded.fileName,
      mimeType: message.document.mime_type || "application/octet-stream",
    });
  }
  if (message.photo?.length) {
    const best = message.photo[message.photo.length - 1]!;
    const downloaded = await telegramDownloadFile(token, best.file_id);
    files.push({
      buffer: downloaded.buffer,
      fileName: downloaded.fileName.endsWith(".jpg") ? downloaded.fileName : `${downloaded.fileName}.jpg`,
      mimeType: "image/jpeg",
    });
  }
  return files;
}

async function collectAccountInboundFiles(
  client: TelegramClient,
  event: NewMessageEvent,
): Promise<InboundMediaFile[]> {
  const media = event.message.media;
  if (!media) return [];
  const buffer = await client.downloadMedia(event.message, {});
  if (!buffer || typeof buffer === "string") return [];
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let fileName = "file.bin";
  let mimeType = "application/octet-stream";
  if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
    mimeType = media.document.mimeType || mimeType;
    const nameAttr = media.document.attributes.find(
      (attr): attr is Api.DocumentAttributeFilename => attr instanceof Api.DocumentAttributeFilename,
    );
    fileName = nameAttr?.fileName || `document.${mimeType.split("/")[1] || "bin"}`;
  } else if (media instanceof Api.MessageMediaPhoto) {
    fileName = `photo-${event.message.id}.jpg`;
    mimeType = "image/jpeg";
  }
  return [{ buffer: data, fileName, mimeType }];
}

async function materializeInboundMedia(input: {
  files: InboundMediaFile[];
  analyze: boolean;
}) {
  const attachments: CrmAttachment[] = [];
  const analyzed: Array<{ fileName: string; text: string }> = [];
  const storedOnly: Array<{ fileName: string }> = [];
  for (const file of input.files.slice(0, 5)) {
    if (file.buffer.length > 83_886_080) continue;
    const saved = await saveInboundTelegramFile(file);
    attachments.push(saved);
    if (input.analyze) {
      const text = await extractInboundMediaText(file);
      analyzed.push({ fileName: saved.name, text });
    } else {
      storedOnly.push({ fileName: saved.name });
    }
  }
  return { attachments, analyzed, storedOnly };
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

async function pulseTyping(opts: {
  connection: { id: string; type: string; encryptedSecret: string };
  threadId: string;
  businessConnectionId?: string;
  stop: { stopped: boolean };
}) {
  const tick = async () => {
    if (opts.stop.stopped) return;
    try {
      if (opts.connection.type === "TELEGRAM_ACCOUNT") {
        const client = accountClients.get(opts.connection.id);
        if (!client) return;
        const peer = await client.getInputEntity(opts.threadId);
        await client.invoke(
          new Api.messages.SetTyping({
            peer,
            action: new Api.SendMessageTypingAction(),
          }),
        );
      } else {
        const token = decryptCrmSecret(opts.connection.encryptedSecret);
        await telegramSendChatAction(
          token,
          opts.threadId,
          "typing",
          opts.businessConnectionId,
        );
      }
    } catch {
      /* typing is best-effort */
    }
  };
  await tick();
  const timer = setInterval(() => {
    void tick();
  }, 4000);
  return () => {
    opts.stop.stopped = true;
    clearInterval(timer);
  };
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
  if (!lead) return;
  if (lead.agentPaused) {
    console.log(`[crm-telegram] skip reply lead=${leadId}: agentPaused`);
    return;
  }
  if (lead.playbook.status !== "RUNNING") {
    console.log(`[crm-telegram] skip reply lead=${leadId}: playbook ${lead.playbook.status}`);
    return;
  }
  if (lead.playbook.channelTelegramEnabled === false) {
    console.log(`[crm-telegram] skip reply lead=${leadId}: channelTelegramEnabled=false`);
    return;
  }

  const urgent = detectUrgentNeed(inboundText);
  if (urgent && !lead.urgentAt) {
    await flagLeadUrgent({
      playbookId: lead.playbookId,
      agentId: lead.playbook.agentId,
      leadId: lead.id,
      reason: urgent,
      snippet: inboundText,
    });
    console.log(`[crm-telegram] urgent lead=${leadId}: ${urgent}`);
  }

  const connection = await prisma.crmChannelConnection.findUnique({ where: { id: connectionId } });
  const conversation = lead.conversations.find((item) => item.channel === "TELEGRAM");
  const stopTyping = { stopped: false };
  let clearTyping: (() => void) | undefined;
  if (connection && conversation?.externalThreadId) {
    const context = parseConfig(conversation.externalContext);
    const businessConnectionId =
      typeof context.businessConnectionId === "string" ? context.businessConnectionId : undefined;
    clearTyping = await pulseTyping({
      connection,
      threadId: conversation.externalThreadId,
      businessConnectionId,
      stop: stopTyping,
    });
  }

  let result: Awaited<ReturnType<typeof generateGroundedSalesDraft>>;
  try {
    result = await generateGroundedSalesDraft({
      kind: "ANSWER",
      prompt: inboundText,
      playbook: lead.playbook,
      lead,
      documents: lead.playbook.documents,
      history: lead.conversations.flatMap((item) => item.messages),
      model: lead.playbook.agent.model,
    });
  } finally {
    clearTyping?.();
  }

  if (!conversation || !result.draft) {
    console.log(`[crm-telegram] skip reply lead=${leadId}: empty draft or no conversation`);
    return;
  }

  const attachmentsJson = JSON.stringify(result.attachments ?? []);
  const wantsEmail = clientAskedEmailDelivery(inboundText);
  // Re-read card: automation may have just saved email from this inbound.
  const fresh = await prisma.salesLead.findUnique({
    where: { id: lead.id },
    select: { email: true },
  });
  const toEmail = extractEmailFromText(inboundText) || normalizeEmail(fresh?.email || lead.email || "");

  let outboundBody = result.draft;
  if (wantsEmail) {
    if (!toEmail) {
      outboundBody = withEmailSendStatus(result.draft, { ok: false, reason: "no-email" });
      console.log(`[crm-telegram] email mirror lead=${leadId}: need address`);
    } else {
      const mirrored = await sendEmailMirrorNow({
        playbookId: lead.playbookId,
        leadId: lead.id,
        body: result.draft,
        attachmentsJson,
        toEmail,
        subject: "Информация по вашему запросу",
      });
      outboundBody = withEmailSendStatus(result.draft, mirrored);
      console.log(
        `[crm-telegram] email mirror lead=${leadId} to=${toEmail} ok=${mirrored.ok}${
          mirrored.ok ? "" : ` (${mirrored.reason})`
        }`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const outboxStatus = outboxStatusForSendMode(lead.playbook.sendMode);
    const message = await tx.crmMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        status: messageStatusForSendMode(lead.playbook.sendMode),
        body: outboundBody,
        attachments: attachmentsJson,
      },
    });
    await tx.crmOutboxMessage.create({
      data: {
        connectionId,
        conversationId: conversation.id,
        messageId: message.id,
        body: outboundBody,
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
    encryptedSecret: string;
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
  const caption = (message?.text ?? message?.caption ?? "").trim();
  const hasMedia = Boolean(message?.document || message?.photo?.length);
  if (!message || message.chat.type !== "private" || (!caption && !hasMedia)) {
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
    const playbook = await prisma.salesPlaybook.findUnique({
      where: { id: connection.playbookId },
      select: {
        status: true,
        systemPrompt: true,
        goals: true,
        product: true,
        restrictions: true,
        qualificationQuestions: true,
      },
    });
    const token = decryptCrmSecret(connection.encryptedSecret);
    const analyze = playbookWantsInboundDocAnalysis(playbook ?? {});
    const inboundFiles = hasMedia ? await collectBotInboundFiles(token, message) : [];
    const media = await materializeInboundMedia({ files: inboundFiles, analyze });
    const prompt = buildInboundPromptWithMedia({
      caption,
      analyzed: media.analyzed,
      storedOnly: media.storedOnly,
    });
    if (!prompt) {
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
    const bodyPreview =
      caption ||
      (media.attachments.length
        ? `Файл: ${media.attachments.map((item) => item.name).join(", ")}`
        : prompt.slice(0, 500));
    await prisma.$transaction([
      prisma.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          status: (playbook?.status ?? connection.playbook.status) === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
          body: bodyPreview,
          attachments: JSON.stringify(media.attachments),
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
    const auto = await applyInboundAutomation(lead.id, caption || prompt);
    if (auto.changes.length) {
      console.log(`[crm-telegram] card updated lead=${lead.id} ${auto.changes.join(", ")}`);
    }
    if (media.analyzed.length) {
      console.log(
        `[crm-telegram] analyzed ${media.analyzed.length} inbound file(s) lead=${lead.id}`,
      );
    }
    await prepareReply(connection.id, lead.id, prompt);
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

/** Two blue ticks for the sender — MTProto does not mark inbox read until the phone opens the chat. */
async function markAccountInboxRead(client: TelegramClient, event: NewMessageEvent) {
  try {
    if (typeof event.message.markAsRead === "function") {
      await event.message.markAsRead();
      return;
    }
    const chat = event.chatId ?? event.message.peerId;
    if (chat != null) await client.markAsRead(chat, event.message.id);
  } catch (cause) {
    console.warn(
      "[crm-telegram] markAsRead failed:",
      cause instanceof Error ? cause.message : cause,
    );
  }
}

async function processAccountMessage(
  connection: { id: string; playbookId: string; playbook: { status: string } },
  client: TelegramClient,
  event: NewMessageEvent,
) {
  if (!event.isPrivate || !event.message.senderId) return;
  const caption = (event.message.text || event.message.message || "").trim();
  const hasMedia = Boolean(event.message.media);
  if (!caption && !hasMedia) return;
  // Mark read immediately so the client sees ✓✓ without opening the phone app.
  void markAccountInboxRead(client, event);
  const externalId = `${event.message.senderId.toString()}:${event.message.id}`;
  try {
    await prisma.crmInboundEvent.create({
      data: {
        connectionId: connection.id,
        externalId,
        payload: JSON.stringify({
          messageId: event.message.id,
          text: caption,
          hasMedia,
        }),
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return;
    throw cause;
  }

  try {
    const playbook = await prisma.salesPlaybook.findUnique({
      where: { id: connection.playbookId },
      select: {
        status: true,
        systemPrompt: true,
        goals: true,
        product: true,
        restrictions: true,
        qualificationQuestions: true,
      },
    });
    const analyze = playbookWantsInboundDocAnalysis(playbook ?? {});
    const inboundFiles = hasMedia ? await collectAccountInboundFiles(client, event) : [];
    const media = await materializeInboundMedia({ files: inboundFiles, analyze });
    const prompt = buildInboundPromptWithMedia({
      caption,
      analyzed: media.analyzed,
      storedOnly: media.storedOnly,
    });
    if (!prompt) {
      await prisma.crmInboundEvent.update({
        where: { connectionId_externalId: { connectionId: connection.id, externalId } },
        data: { status: "IGNORED", processedAt: new Date() },
      });
      return;
    }

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
    const bodyPreview =
      caption ||
      (media.attachments.length
        ? `Файл: ${media.attachments.map((item) => item.name).join(", ")}`
        : prompt.slice(0, 500));
    await prisma.$transaction([
      prisma.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          status: (playbook?.status ?? connection.playbook.status) === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
          body: bodyPreview,
          attachments: JSON.stringify(media.attachments),
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
    console.log(`[crm-telegram] card ready lead=${lead.id} @${username || userId}`);
    const auto = await applyInboundAutomation(lead.id, caption || prompt);
    if (auto.changes.length) {
      console.log(`[crm-telegram] card updated lead=${lead.id} ${auto.changes.join(", ")}`);
    }
    if (media.analyzed.length) {
      console.log(
        `[crm-telegram] analyzed ${media.analyzed.length} inbound file(s) lead=${lead.id}`,
      );
    }
    await prepareReply(connection.id, lead.id, prompt);
  } catch (cause) {
    console.error(
      "[crm-telegram] processAccountMessage failed:",
      cause instanceof Error ? cause.message : cause,
    );
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
  // Kick the update stream — otherwise NewMessage may never fire on some hosts.
  await client.getMe().catch(() => undefined);
  await client.getDialogs({ limit: 20 }).catch(() => undefined);
  client.addEventHandler(
    (event) => {
      console.log(
        `[crm-telegram] MTProto message playbook=${connection.playbookId} private=${Boolean(event.isPrivate)}`,
      );
      void processAccountMessage(connection, client, event).catch((cause) => {
        console.error("[crm-telegram] account update:", cause instanceof Error ? cause.message : cause);
      });
    },
    new NewMessage({ incoming: true }),
  );
  accountClients.set(connection.id, client);
  console.log(`[crm-telegram] MTProto listening connection=${connection.id}`);
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

function isPeerFloodError(message: string) {
  return /PEER_FLOOD|FLOOD_WAIT|Too many requests/i.test(message);
}

function isHardSendError(message: string) {
  return /USER_BANNED|PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|INPUT_USER_DEACTIVATED|bot was blocked|chat not found/i.test(
    message,
  );
}

async function deliverApproved() {
  const morning = nextOutboundMorning();
  const morningLabel = morning.toLocaleString("ru-RU", {
    timeZone: "Europe/Minsk",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  await prisma.crmOutboxMessage.updateMany({
    where: {
      connection: { type: { in: ["TELEGRAM", "TELEGRAM_ACCOUNT"] } },
      OR: [{ status: { in: ["FAILED", "DEAD"] } }, { status: "APPROVED", attempts: { gte: 5 } }],
      NOT: {
        OR: [
          { error: { contains: "PEER_ID_INVALID" } },
          { error: { contains: "USERNAME_NOT_OCCUPIED" } },
          { error: { contains: "USER_BANNED" } },
          { error: { contains: "В очереди на" } },
        ],
      },
    },
    data: {
      status: "APPROVED",
      attempts: 0,
      nextAttemptAt: morning,
      error: `Не отправлено. В очереди на ${morningLabel}.`,
    },
  });

  const rows = await prisma.crmOutboxMessage.findMany({
    where: {
      status: "APPROVED",
      nextAttemptAt: { lte: new Date() },
      attempts: { lt: 5 },
      connection: {
        type: { in: ["TELEGRAM", "TELEGRAM_ACCOUNT"] },
        status: "CONNECTED",
      },
    },
    orderBy: { createdAt: "asc" },
    take: 40,
    include: {
      connection: true,
      conversation: { select: { externalThreadId: true, externalContext: true } },
      message: { select: { attachments: true } },
    },
  });

  // One send per Telegram connection per tick — respects playbook interval.
  const seenConnections = new Set<string>();
  for (const row of rows) {
    if (seenConnections.has(row.connectionId)) continue;
    seenConnections.add(row.connectionId);

    const claimed = await prisma.crmOutboxMessage.updateMany({
      where: { id: row.id, status: "APPROVED" },
      data: { status: "SENDING" },
    });
    if (!claimed.count) continue;
    try {
      const playbook = await prisma.salesPlaybook.findUniqueOrThrow({
        where: { id: row.connection.playbookId },
        select: { status: true, telegramSendIntervalSeconds: true },
      });
      let attachments: CrmAttachment[] = [];
      try {
        attachments = JSON.parse(row.message.attachments || "[]") as CrmAttachment[];
      } catch {
        attachments = [];
      }
      // Prefer text-only for personal-account cold sends — files trigger PEER_FLOOD.
      const allowMedia = row.connection.type !== "TELEGRAM_ACCOUNT";
      const media = allowMedia
        ? attachments
            .map((item) => {
              const fullPath = crmUploadAbsolutePath(item.url);
              if (!fullPath) return null;
              return { ...item, fullPath };
            })
            .filter((item): item is CrmAttachment & { fullPath: string } => Boolean(item))
        : [];

      let sentExternalId = "";
      // Brief typing right before the message lands.
      try {
        if (row.connection.type === "TELEGRAM_ACCOUNT") {
          const client = await ensureAccountClient({ ...row.connection, playbook });
          const peer = await client.getInputEntity(row.conversation.externalThreadId);
          await client.invoke(
            new Api.messages.SetTyping({
              peer,
              action: new Api.SendMessageTypingAction(),
            }),
          );
        } else {
          const token = decryptCrmSecret(row.connection.encryptedSecret);
          const context = parseConfig(row.conversation.externalContext);
          await telegramSendChatAction(
            token,
            row.conversation.externalThreadId,
            media.length ? (isCrmImageMime(media[0]?.mimeType ?? "") ? "upload_photo" : "upload_document") : "typing",
            typeof context.businessConnectionId === "string" ? context.businessConnectionId : undefined,
          );
        }
      } catch {
        /* ignore */
      }
      if (row.connection.type === "TELEGRAM_ACCOUNT") {
        const client = await ensureAccountClient({ ...row.connection, playbook });
        if (media.length) {
          for (let index = 0; index < media.length; index += 1) {
            const item = media[index]!;
            const displayName = outboundAttachmentName(item.name, item.fullPath);
            const sent = await client.sendFile(row.conversation.externalThreadId, {
              file: new CustomFile(displayName, statSync(item.fullPath).size, item.fullPath),
              caption: index === 0 ? row.body.slice(0, 1024) : undefined,
              forceDocument: !isCrmImageMime(item.mimeType),
            });
            sentExternalId = String(sent.id);
          }
        } else {
          const sent = await client.sendMessage(row.conversation.externalThreadId, {
            message: row.body,
          });
          sentExternalId = String(sent.id);
        }
      } else {
        const token = decryptCrmSecret(row.connection.encryptedSecret);
        const context = parseConfig(row.conversation.externalContext);
        const businessConnectionId =
          typeof context.businessConnectionId === "string" ? context.businessConnectionId : undefined;
        if (media.length) {
          for (let index = 0; index < media.length; index += 1) {
            const item = media[index]!;
            const caption = index === 0 ? row.body : undefined;
            const displayName = outboundAttachmentName(item.name, item.fullPath);
            const sent = isCrmImageMime(item.mimeType)
              ? await telegramSendPhotoFile(
                  token,
                  row.conversation.externalThreadId,
                  item.fullPath,
                  caption,
                  businessConnectionId,
                  displayName,
                )
              : await telegramSendDocumentFile(
                  token,
                  row.conversation.externalThreadId,
                  item.fullPath,
                  caption,
                  businessConnectionId,
                  displayName,
                );
            sentExternalId = String(sent.message_id);
          }
        } else {
          const sent = await telegramSendMessage(
            token,
            row.conversation.externalThreadId,
            row.body,
            businessConnectionId,
          );
          sentExternalId = String(sent.message_id);
        }
      }
      const intervalSec = Math.max(10, playbook.telegramSendIntervalSeconds || 300);
      const nextSlot = new Date(Date.now() + intervalSec * 1000);
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
        // Push remaining queue for this connection so we don't blast every second.
        prisma.crmOutboxMessage.updateMany({
          where: {
            connectionId: row.connectionId,
            status: "APPROVED",
            id: { not: row.id },
            nextAttemptAt: { lt: nextSlot },
          },
          data: { nextAttemptAt: nextSlot },
        }),
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 800) : "Ошибка отправки";
      const hard = isHardSendError(message);
      const when = nextOutboundMorning();
      const whenLabel = when.toLocaleString("ru-RU", {
        timeZone: "Europe/Minsk",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      const note = isPeerFloodError(message)
        ? `Telegram ограничил отправку. Не отправлено. В очереди на ${whenLabel}.`
        : `Не отправлено: ${message}. В очереди на ${whenLabel}.`;
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: hard
            ? {
                status: "FAILED",
                attempts: row.attempts + 1,
                nextAttemptAt: new Date(),
                error: message,
              }
            : {
                status: "APPROVED",
                attempts: 0,
                nextAttemptAt: when,
                error: note,
              },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: hard ? "FAILED" : "APPROVED" },
        }),
      ]);
    }
  }
}

async function main() {
  console.log("[crm-telegram] worker started");
  let lastIdleLogAt = 0;
  while (!stopping) {
    await runCrmRecovery();
    await syncAccountClients();
    await deliverApproved();
    const botConnections = await prisma.crmChannelConnection.findMany({
      where: { type: "TELEGRAM", status: "CONNECTED" },
      include: { playbook: { select: { status: true } } },
    });
    const accountCount = accountClients.size;
    if (!botConnections.length) {
      // Account-only mode: MTProto listeners stay alive via syncAccountClients.
      if (accountCount === 0) {
        const now = Date.now();
        if (now - lastIdleLogAt > 60_000) {
          console.log("[crm-telegram] idle: нет CONNECTED бота и нет CONNECTED аккаунта");
          lastIdleLogAt = now;
        }
      }
      await pause(3_000);
      continue;
    }
    for (const connection of botConnections) {
      if (stopping) break;
      await pollConnection(connection);
    }
    // If bots returned quickly (no updates), yield so MTProto handlers can run.
    if (botConnections.length && accountCount) await pause(500);
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
