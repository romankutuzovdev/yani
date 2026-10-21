import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import { encryptCrmSecret } from "@/lib/crmSecrets";
import { testEmailConnection, type CrmEmailConfig } from "@/lib/crmEmail";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  agentId: z.string().optional(),
  email: z.string().trim().email(),
  username: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(1000),
  imapHost: z.string().trim().min(1).max(255),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(1).max(255),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  fromName: z.string().trim().max(200).default(""),
  signature: z.string().trim().max(4000).default(""),
});

function publicConnection(connection: {
  id: string;
  status: string;
  config: string;
  lastError: string;
  lastPolledAt: Date | null;
  updatedAt: Date;
} | null) {
  if (!connection) return null;
  let config: Partial<CrmEmailConfig> = {};
  try {
    config = JSON.parse(connection.config);
  } catch {
    config = {};
  }
  return {
    id: connection.id,
    status: connection.status,
    email: config.email ?? "",
    username: config.username ?? "",
    imapHost: config.imapHost ?? "",
    imapPort: config.imapPort ?? 993,
    imapSecure: config.imapSecure ?? true,
    smtpHost: config.smtpHost ?? "",
    smtpPort: config.smtpPort ?? 465,
    smtpSecure: config.smtpSecure ?? true,
    fromName: config.fromName ?? "",
    signature: config.signature ?? "",
    lastError: connection.lastError,
    lastPolledAt: connection.lastPolledAt,
    updatedAt: connection.updatedAt,
  };
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const connection = await prisma.crmChannelConnection.findUnique({
    where: { playbookId_type: { playbookId: id, type: "EMAIL" } },
  });
  return json({ connection: publicConnection(connection) });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const input = schema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, input.agentId);
    if (playbook instanceof Response) return playbook;
    const config: CrmEmailConfig = {
      email: input.email.toLowerCase(),
      username: input.username,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      fromName: input.fromName,
      signature: input.signature,
    };
    const tested = await testEmailConnection(config, { password: input.password });
    config.lastUid = Math.max(0, tested.uidNext - 1);
    config.uidValidity = tested.uidValidity;

    const connection = await prisma.crmChannelConnection.upsert({
      where: { playbookId_type: { playbookId: id, type: "EMAIL" } },
      create: {
        playbookId: id,
        type: "EMAIL",
        status: "CONNECTED",
        config: JSON.stringify(config),
        encryptedSecret: encryptCrmSecret(JSON.stringify({ password: input.password })),
      },
      update: {
        status: "CONNECTED",
        config: JSON.stringify(config),
        encryptedSecret: encryptCrmSecret(JSON.stringify({ password: input.password })),
        lastError: "",
      },
    });
    await writeLog({
      type: "crm_channel",
      message: `К навыку «${playbook.name}» подключена почта ${config.email}`,
      agentId: playbook.agentId,
      meta: { playbookId: id, connectionId: connection.id },
    });
    return json({ connection: publicConnection(connection) });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте настройки");
    return error(cause instanceof Error ? cause.message : "Не удалось подключить почту", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  await prisma.crmChannelConnection.deleteMany({ where: { playbookId: id, type: "EMAIL" } });
  await writeLog({
    type: "crm_channel",
    message: `От навыка «${playbook.name}» отключена почта`,
    agentId: playbook.agentId,
    meta: { playbookId: id },
  });
  return json({ ok: true });
}
