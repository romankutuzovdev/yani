import { readFile } from "fs/promises";
import { prisma } from "@/lib/db";
import { decryptCrmSecret } from "@/lib/crmSecrets";
import { createSmtpTransport, htmlEmail, type CrmEmailConfig, type CrmEmailSecret } from "@/lib/crmEmail";
import { normalizeEmail } from "@/lib/crm";
import { writeLog } from "@/lib/api";
import { crmUploadAbsolutePath, outboundAttachmentName, type CrmAttachment } from "@/lib/crmMedia";

const URGENT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /срочн/i, reason: "Клиент пишет, что это срочно" },
  { re: /перезвон/i, reason: "Клиент просит перезвонить" },
  { re: /позвоните|позвонить|звоните/i, reason: "Клиент просит позвонить" },
  { re: /свяжит[еь]сь\s+с\s+(менеджер|оператор|человек)/i, reason: "Клиент просит связаться с менеджером" },
  { re: /живой\s+человек|не\s+бот|менеджер\s+нужен/i, reason: "Клиент просит живого человека" },
  { re: /\basap\b|\burgent\b/i, reason: "Urgent request from client" },
  { re: /сегодня\s+нужно|прямо\s+сейчас|немедленно/i, reason: "Клиент просит связаться немедленно" },
];

/** Client wants the answer / materials on email (with or without an address in the same message). */
export function clientAskedEmailDelivery(text: string) {
  const t = text.toLowerCase();
  if (/на\s+(почт|email|e-?mail|емейл|имейл)/i.test(t)) return true;
  if (
    /(почт[уеыа]|email|e-?mail|емейл|имейл)/i.test(t) &&
    /(отправ|пришли|вышли|скинь|перешли|направ|дублир)/i.test(t)
  ) {
    return true;
  }
  return false;
}

export function extractEmailFromText(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return normalizeEmail(match?.[0] ?? "");
}

export function detectUrgentNeed(text: string): string | null {
  for (const item of URGENT_PATTERNS) {
    if (item.re.test(text)) return item.reason;
  }
  return null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Remove LLM claims that mail was already sent — we append the real status ourselves. */
export function scrubEmailSendClaims(body: string) {
  return body
    .replace(
      /[^.!?\n]*(?:уже\s+)?(?:отправил[аи]?|выслал[аи]?|направил[аи]?|дублировал[аи]?)[^.!?\n]*(?:почт|email|e-?mail|ящик)[^.!?\n]*[.!?]?/gi,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function withEmailSendStatus(
  body: string,
  status: { ok: true; to: string } | { ok: false; reason: string; to?: string },
) {
  const clean = scrubEmailSendClaims(body);
  if (status.ok) {
    return `${clean}\n\nДублирую это же письмо на ${status.to}.`.trim();
  }
  if (status.reason === "no-email") {
    return `${clean}\n\nНапишите, пожалуйста, email — сразу отправлю туда подробности.`.trim();
  }
  if (status.reason === "email-not-connected" || status.reason === "email-channel-off") {
    return `${clean}\n\nСейчас не могу отправить на почту (канал не подключён). Могу продолжить здесь в чате.`.trim();
  }
  return `${clean}\n\nНе удалось отправить на почту${status.to ? ` (${status.to})` : ""} — повторим чуть позже. Пока ответ здесь.`.trim();
}

/**
 * Send the Telegram reply to the client's email right now (SMTP),
 * and store it in the EMAIL conversation as SENT.
 */
export async function sendEmailMirrorNow(input: {
  playbookId: string;
  leadId: string;
  body: string;
  attachmentsJson?: string;
  toEmail?: string;
  subject?: string;
}): Promise<{ ok: true; to: string } | { ok: false; reason: string; to?: string }> {
  const email = normalizeEmail(input.toEmail ?? "");
  if (!email) return { ok: false, reason: "no-email" };

  const playbook = await prisma.salesPlaybook.findUnique({
    where: { id: input.playbookId },
    select: { channelEmailEnabled: true },
  });
  if (playbook?.channelEmailEnabled === false) {
    return { ok: false, reason: "email-channel-off", to: email };
  }

  const connection = await prisma.crmChannelConnection.findUnique({
    where: { playbookId_type: { playbookId: input.playbookId, type: "EMAIL" } },
  });
  if (!connection || connection.status !== "CONNECTED") {
    return { ok: false, reason: "email-not-connected", to: email };
  }

  const config = parseJson<CrmEmailConfig>(connection.config, {} as CrmEmailConfig);
  const secret = parseJson<CrmEmailSecret>(
    decryptCrmSecret(connection.encryptedSecret),
    {} as CrmEmailSecret,
  );
  if (!config.smtpHost || !config.email || !secret.password) {
    return { ok: false, reason: "email-not-connected", to: email };
  }

  const media = parseJson<CrmAttachment[]>(input.attachmentsJson || "[]", []);
  const mailAttachments = [];
  for (const item of media.slice(0, 5)) {
    const fullPath = crmUploadAbsolutePath(item.url);
    if (!fullPath) continue;
    try {
      mailAttachments.push({
        filename: outboundAttachmentName(item.name, fullPath),
        content: await readFile(fullPath),
        contentType: item.mimeType,
        contentDisposition: "attachment" as const,
      });
    } catch {
      /* skip missing file */
    }
  }

  const subject = (input.subject || "Информация по вашему запросу").slice(0, 200);
  let messageId = "";
  try {
    const transport = createSmtpTransport(config, secret);
    const sent = await transport.sendMail({
      from: { name: config.fromName || config.email, address: config.email },
      to: email,
      subject,
      text: `${input.body}${config.signature ? `\n\n—\n${config.signature}` : ""}`,
      html: htmlEmail(input.body, config.signature || ""),
      attachments: mailAttachments,
    });
    transport.close();
    messageId = String(sent.messageId || "");
  } catch (cause) {
    console.warn(
      "[crm-email-mirror] SMTP failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { ok: false, reason: "smtp-failed", to: email };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.salesLead.findUnique({
      where: { id: input.leadId },
      select: { email: true },
    });
    if (!current?.email?.trim()) {
      await tx.salesLead.update({ where: { id: input.leadId }, data: { email } });
    }
    const conversation = await tx.crmConversation.upsert({
      where: { leadId_channel: { leadId: input.leadId, channel: "EMAIL" } },
      create: {
        leadId: input.leadId,
        channel: "EMAIL",
        externalThreadId: email,
        externalContext: JSON.stringify({
          subject,
          firstContact: true,
          mirroredFrom: "TELEGRAM",
        }),
        lastMessageAt: now,
      },
      update: {
        externalThreadId: email,
        lastMessageAt: now,
        externalContext: JSON.stringify({
          subject,
          firstContact: false,
          mirroredFrom: "TELEGRAM",
        }),
      },
    });
    const message = await tx.crmMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        status: "SENT",
        body: input.body,
        attachments: input.attachmentsJson ?? "[]",
        externalId: messageId,
      },
    });
    await tx.crmOutboxMessage.create({
      data: {
        connectionId: connection.id,
        conversationId: conversation.id,
        messageId: message.id,
        body: input.body,
        status: "SENT",
        approvedAt: now,
        sentAt: now,
        externalId: messageId,
        nextAttemptAt: now,
      },
    });
  });

  return { ok: true, to: email };
}

/** @deprecated use sendEmailMirrorNow — kept name for older imports */
export async function queueEmailMirror(input: {
  playbookId: string;
  leadId: string;
  body: string;
  attachmentsJson?: string;
  sendMode?: string;
  toEmail?: string;
}) {
  return sendEmailMirrorNow(input);
}

/** Mark lead urgent and email the org owner (via playbook SMTP if available). */
export async function flagLeadUrgent(input: {
  playbookId: string;
  agentId: string;
  leadId: string;
  reason: string;
  snippet: string;
}) {
  const lead = await prisma.salesLead.update({
    where: { id: input.leadId },
    data: {
      urgentAt: new Date(),
      urgentNote: input.reason.slice(0, 300),
    },
  });

  await prisma.crmAuditEvent.create({
    data: {
      playbookId: input.playbookId,
      agentId: input.agentId,
      action: "lead.urgent",
      entityType: "SalesLead",
      entityId: input.leadId,
      summary: input.reason,
      meta: JSON.stringify({ snippet: input.snippet.slice(0, 400) }),
    },
  });

  await writeLog({
    type: "crm_urgent",
    message: `Срочно: ${input.reason} — ${lead.displayName || lead.email || lead.telegram || lead.id}`,
    agentId: input.agentId,
    meta: { leadId: input.leadId, playbookId: input.playbookId },
  });

  const org = await prisma.user.findFirst({
    where: { orgAgentId: input.agentId, role: "ORG" },
    select: { email: true, name: true },
  });
  const notifyTo = org?.email?.trim();
  if (!notifyTo) return { lead, mailed: false };

  const connection = await prisma.crmChannelConnection.findUnique({
    where: { playbookId_type: { playbookId: input.playbookId, type: "EMAIL" } },
  });
  if (!connection || connection.status !== "CONNECTED") return { lead, mailed: false };

  try {
    const config = parseJson<CrmEmailConfig>(connection.config, {} as CrmEmailConfig);
    const secret = parseJson<CrmEmailSecret>(
      decryptCrmSecret(connection.encryptedSecret),
      {} as CrmEmailSecret,
    );
    const transport = createSmtpTransport(config, secret);
    const subject = `Срочно CRM: ${lead.displayName || lead.company || "клиент"}`;
    const text = [
      input.reason,
      "",
      `Клиент: ${lead.displayName || "—"}`,
      `Компания: ${lead.company || "—"}`,
      `Телефон: ${lead.phone || "—"}`,
      `Email: ${lead.email || "—"}`,
      `Telegram: ${lead.telegram || "—"}`,
      "",
      `Сообщение: ${input.snippet.slice(0, 800)}`,
      "",
      "Откройте CRM и перезвоните / напишите клиенту.",
    ].join("\n");
    await transport.sendMail({
      from: { name: config.fromName || config.email || "Yani CRM", address: config.email },
      to: notifyTo,
      subject,
      text,
      html: htmlEmail(text, ""),
    });
    transport.close();
    return { lead, mailed: true };
  } catch (cause) {
    console.warn(
      "[crm-urgent] notify mail failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return { lead, mailed: false };
  }
}
