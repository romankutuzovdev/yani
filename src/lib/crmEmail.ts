import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export type CrmEmailConfig = {
  email: string;
  username: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  fromName: string;
  signature: string;
  lastUid?: number;
  uidValidity?: string;
};

export type CrmEmailSecret = {
  password: string;
};

export function createImapClient(config: CrmEmailConfig, secret: CrmEmailSecret) {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.username, pass: secret.password },
    logger: false,
  });
}

export function createSmtpTransport(config: CrmEmailConfig, secret: CrmEmailSecret) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: { user: config.username, pass: secret.password },
  });
}

export async function testEmailConnection(config: CrmEmailConfig, secret: CrmEmailSecret) {
  const imap = createImapClient(config, secret);
  await imap.connect();
  let uidNext = 1;
  let uidValidity = "";
  try {
    const mailbox = await imap.mailboxOpen("INBOX");
    uidNext = Number(mailbox.uidNext ?? 1);
    uidValidity = String(mailbox.uidValidity ?? "");
  } finally {
    await imap.logout().catch(() => undefined);
  }

  const smtp = createSmtpTransport(config, secret);
  await smtp.verify();
  smtp.close();
  return { uidNext, uidValidity };
}

export function htmlEmail(text: string, signature: string) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const signatureHtml = signature.trim()
    ? `<br><br>—<br>${signature.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}`
    : "";
  return `<div>${escaped}${signatureHtml}</div>`;
}
