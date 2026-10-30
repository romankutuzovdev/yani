import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { simpleParser, type Attachment } from "mailparser";
import { prisma } from "@/lib/db";
import { processCampaignQueue } from "@/lib/crmCampaign";
import { runCrmRecovery } from "@/lib/crmRecovery";
import { decryptCrmSecret } from "@/lib/crmSecrets";
import {
  createImapClient,
  createSmtpTransport,
  htmlEmail,
  type CrmEmailConfig,
  type CrmEmailSecret,
} from "@/lib/crmEmail";
import { generateGroundedSalesDraft } from "@/lib/crmGrounding";
import { normalizeEmail } from "@/lib/crm";
import {
  applyInboundAutomation,
  nextOutboundMorning,
  messageStatusForSendMode,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";
import { detectUrgentNeed, flagLeadUrgent } from "@/lib/crmDialogExtras";
import { crmUploadAbsolutePath, outboundAttachmentName, type CrmAttachment } from "@/lib/crmMedia";

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function saveAttachments(attachments: Attachment[]) {
  if (!attachments.length) return [];
  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "email-attachments");
  await mkdir(dir, { recursive: true });
  const saved = [];
  for (const attachment of attachments.slice(0, 10)) {
    if (attachment.size > 83_886_080) continue; // 80MB
    const original = (attachment.filename || "attachment").split(/[/\\]/).pop() || "attachment";
    const extension = path.extname(original).slice(0, 12);
    const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}${extension}`;
    await writeFile(path.join(dir, fileName), attachment.content);
    saved.push({
      name: original.slice(0, 220),
      url: `/uploads/email-attachments/${fileName}`,
      mimeType: attachment.contentType,
      size: attachment.size,
    });
  }
  return saved;
}

async function leadForEmail(playbookId: string, address: string, name: string) {
  const normalized = normalizeEmail(address);
  const identity = await prisma.leadIdentity.findUnique({
    where: {
      playbookId_type_value: {
        playbookId,
        type: "EMAIL",
        value: normalized,
      },
    },
    select: { leadId: true },
  });
  if (identity) return prisma.salesLead.findUniqueOrThrow({ where: { id: identity.leadId } });
  return prisma.$transaction(async (tx) => {
    const lead = await tx.salesLead.create({
      data: {
        playbookId,
        displayName: name,
        email: normalized,
        stage: "COMMUNICATING",
        lastContactAt: new Date(),
      },
    });
    await tx.leadIdentity.create({
      data: {
        playbookId,
        leadId: lead.id,
        type: "EMAIL",
        value: normalized,
        originalValue: address,
      },
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
  if (!lead || lead.agentPaused || lead.playbook.status !== "RUNNING") return;
  if (lead.playbook.channelEmailEnabled === false) {
    console.log(`[crm-email] skip reply lead=${leadId}: channelEmailEnabled=false`);
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
    console.log(`[crm-email] urgent lead=${leadId}: ${urgent}`);
  }
  const result = await generateGroundedSalesDraft({
    kind: "ANSWER",
    prompt: inboundText,
    playbook: lead.playbook,
    lead,
    documents: lead.playbook.documents,
    history: lead.conversations.flatMap((conversation) => conversation.messages),
    model: lead.playbook.agent.model,
  });
  const conversation = lead.conversations.find((item) => item.channel === "EMAIL");
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
        attachments: JSON.stringify(result.attachments ?? []),
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

async function processIncoming(
  connection: { id: string; playbookId: string; playbook: { status: string } },
  uid: number,
  source: Buffer,
) {
  const parsed = await simpleParser(source);
  const sender = parsed.from?.value[0];
  const address = normalizeEmail(sender?.address ?? "");
  if (!address) return;
  const externalId = parsed.messageId?.trim() || `uid:${uid}`;
  try {
    await prisma.crmInboundEvent.create({
      data: {
        connectionId: connection.id,
        externalId,
        payload: JSON.stringify({
          uid,
          messageId: parsed.messageId,
          subject: parsed.subject,
          from: address,
        }),
      },
    });
  } catch (cause) {
    if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return;
    throw cause;
  }

  try {
    const lead = await leadForEmail(connection.playbookId, address, sender?.name ?? "");
    const now = new Date();
    const previous = await prisma.crmConversation.findUnique({
      where: { leadId_channel: { leadId: lead.id, channel: "EMAIL" } },
      select: { externalContext: true },
    });
    const previousContext = parseJson<Record<string, unknown>>(previous?.externalContext ?? "{}", {});
    const references = Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references ? [parsed.references] : [];
    const context = {
      ...previousContext,
      subject: parsed.subject || previousContext.subject || "Переписка",
      messageId: parsed.messageId || previousContext.messageId || "",
      references,
    };
    const conversation = await prisma.crmConversation.upsert({
      where: { leadId_channel: { leadId: lead.id, channel: "EMAIL" } },
      create: {
        leadId: lead.id,
        channel: "EMAIL",
        externalThreadId: address,
        externalContext: JSON.stringify(context),
        lastMessageAt: now,
      },
      update: {
        externalThreadId: address,
        externalContext: JSON.stringify(context),
        lastMessageAt: now,
      },
    });
    const attachments = await saveAttachments(parsed.attachments);
    const body = (parsed.text || parsed.html || "").toString().trim() || "(письмо без текста)";
    await prisma.$transaction([
      prisma.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: "INBOUND",
          status: connection.playbook.status === "RUNNING" ? "RECEIVED" : "WAITING_AGENT",
          body,
          attachments: JSON.stringify(attachments),
          externalId,
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
    const auto = await applyInboundAutomation(lead.id, body);
    if (auto.changes.length) {
      console.log(`[crm-email] card updated lead=${lead.id} ${auto.changes.join(", ")}`);
    }
    await prepareReply(connection.id, lead.id, body);
  } catch (cause) {
    await prisma.crmInboundEvent.update({
      where: { connectionId_externalId: { connectionId: connection.id, externalId } },
      data: {
        status: "FAILED",
        error: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка обработки письма",
        processedAt: new Date(),
      },
    });
  }
}

async function pollMailbox(connection: {
  id: string;
  playbookId: string;
  config: string;
  encryptedSecret: string;
  playbook: { status: string };
}) {
  const config = parseJson<CrmEmailConfig>(connection.config, {} as CrmEmailConfig);
  const secret = parseJson<CrmEmailSecret>(
    decryptCrmSecret(connection.encryptedSecret),
    {} as CrmEmailSecret,
  );
  const imap = createImapClient(config, secret);
  await imap.connect();
  let highestUid = Number(config.lastUid ?? 0);
  try {
    const lock = await imap.getMailboxLock("INBOX");
    try {
      const mailbox = await imap.mailboxOpen("INBOX");
      const uidValidity = String(mailbox.uidValidity ?? "");
      if (config.uidValidity && config.uidValidity !== uidValidity) highestUid = 0;
      const range = `${Math.max(1, highestUid + 1)}:*`;
      for await (const message of imap.fetch(range, { uid: true, source: true }, { uid: true })) {
        if (!message.uid || !message.source || message.uid <= highestUid) continue;
        await processIncoming(connection, message.uid, message.source);
        highestUid = Math.max(highestUid, message.uid);
      }
      config.uidValidity = uidValidity;
    } finally {
      lock.release();
    }
  } finally {
    await imap.logout().catch(() => undefined);
  }
  config.lastUid = highestUid;
  await prisma.crmChannelConnection.update({
    where: { id: connection.id },
    data: { config: JSON.stringify(config), lastPolledAt: new Date(), lastError: "" },
  });
}

async function deliverApproved() {
  const rows = await prisma.crmOutboxMessage.findMany({
    where: {
      status: "APPROVED",
      nextAttemptAt: { lte: new Date() },
      attempts: { lt: 5 },
      connection: { type: "EMAIL", status: "CONNECTED" },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      connection: true,
      conversation: true,
      message: { select: { attachments: true } },
    },
  });

  for (const row of rows) {
    const claimed = await prisma.crmOutboxMessage.updateMany({
      where: { id: row.id, status: "APPROVED" },
      data: { status: "SENDING" },
    });
    if (!claimed.count) continue;
    try {
      const config = parseJson<CrmEmailConfig>(row.connection.config, {} as CrmEmailConfig);
      const secret = parseJson<CrmEmailSecret>(
        decryptCrmSecret(row.connection.encryptedSecret),
        {} as CrmEmailSecret,
      );
      const context = parseJson<Record<string, unknown>>(row.conversation.externalContext, {});
      const subjectRaw = typeof context.subject === "string" ? context.subject : "Предложение";
      const firstContact = context.firstContact === true;
      const subject = firstContact || /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`;
      const messageId = typeof context.messageId === "string" ? context.messageId : undefined;
      const references = Array.isArray(context.references)
        ? context.references.filter((item): item is string => typeof item === "string")
        : [];
      const media = parseJson<CrmAttachment[]>(row.message.attachments || "[]", []);
      const mailAttachments = [];
      for (const item of media.slice(0, 5)) {
        const fullPath = crmUploadAbsolutePath(item.url);
        if (!fullPath) continue;
        mailAttachments.push({
          filename: outboundAttachmentName(item.name, fullPath),
          content: await readFile(fullPath),
          contentType: item.mimeType,
          contentDisposition: "attachment" as const,
        });
      }
      const transport = createSmtpTransport(config, secret);
      const sent = await transport.sendMail({
        from: { name: config.fromName || config.email, address: config.email },
        to: row.conversation.externalThreadId,
        subject,
        text: `${row.body}${config.signature ? `\n\n—\n${config.signature}` : ""}`,
        html: htmlEmail(row.body, config.signature),
        attachments: mailAttachments,
        inReplyTo: messageId,
        references: [...references, ...(messageId ? [messageId] : [])],
      });
      transport.close();
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            attempts: { increment: 1 },
            externalId: sent.messageId,
            sentAt: new Date(),
            error: "",
          },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: "SENT", externalId: sent.messageId },
        }),
      ]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 800) : "Ошибка SMTP";
      const when = nextOutboundMorning();
      const whenLabel = when.toLocaleString("ru-RU", {
        timeZone: "Europe/Minsk",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      await prisma.$transaction([
        prisma.crmOutboxMessage.update({
          where: { id: row.id },
          data: {
            status: "APPROVED",
            attempts: 0,
            nextAttemptAt: when,
            error: `Не отправлено: ${message}. В очереди на ${whenLabel}.`,
          },
        }),
        prisma.crmMessage.update({
          where: { id: row.messageId },
          data: { status: "APPROVED" },
        }),
      ]);
    }
  }
}

async function main() {
  console.log("[crm-email] worker started");
  while (!stopping) {
    await runCrmRecovery();
    await processCampaignQueue();
    await deliverApproved();
    const connections = await prisma.crmChannelConnection.findMany({
      where: { type: "EMAIL", status: "CONNECTED" },
      include: { playbook: { select: { status: true } } },
    });
    for (const connection of connections) {
      try {
        await pollMailbox(connection);
      } catch (cause) {
        await prisma.crmChannelConnection.update({
          where: { id: connection.id },
          data: {
            lastError: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка IMAP",
          },
        });
      }
    }
    await pause(Number(process.env.CRM_EMAIL_POLL_MS ?? 15_000));
  }
  await prisma.$disconnect();
  console.log("[crm-email] worker stopped");
}

main().catch(async (cause) => {
  console.error("[crm-email] fatal:", cause instanceof Error ? cause.message : cause);
  await prisma.$disconnect();
  process.exit(1);
});
