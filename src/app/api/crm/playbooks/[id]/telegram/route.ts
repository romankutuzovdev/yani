import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import { encryptCrmSecret } from "@/lib/crmSecrets";
import { telegramGetMe, telegramRequest } from "@/lib/telegram";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  agentId: z.string().optional(),
  token: z.string().trim().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, "Неверный формат Bot Token"),
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
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(connection.config);
  } catch {
    config = {};
  }
  return {
    id: connection.id,
    status: connection.status,
    botId: config.botId ?? null,
    username: config.username ?? "",
    firstName: config.firstName ?? "",
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
    where: { playbookId_type: { playbookId: id, type: "TELEGRAM" } },
  });
  return json({ connection: publicConnection(connection) });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = schema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;
    const bot = await telegramGetMe(body.token);
    if (!bot.is_bot) return error("Этот токен не принадлежит Telegram-боту");
    await telegramRequest<boolean>(body.token, "deleteWebhook", { drop_pending_updates: false }, 12_000);

    const connection = await prisma.crmChannelConnection.upsert({
      where: { playbookId_type: { playbookId: id, type: "TELEGRAM" } },
      create: {
        playbookId: id,
        type: "TELEGRAM",
        encryptedSecret: encryptCrmSecret(body.token),
        config: JSON.stringify({
          botId: String(bot.id),
          username: bot.username ?? "",
          firstName: bot.first_name,
          offset: 0,
        }),
      },
      update: {
        status: "CONNECTED",
        encryptedSecret: encryptCrmSecret(body.token),
        config: JSON.stringify({
          botId: String(bot.id),
          username: bot.username ?? "",
          firstName: bot.first_name,
          offset: 0,
        }),
        lastError: "",
      },
    });
    await writeLog({
      type: "crm_channel",
      message: `К навыку «${playbook.name}» подключён Telegram-бот @${bot.username ?? bot.id}`,
      agentId: playbook.agentId,
      meta: { playbookId: id, connectionId: connection.id },
    });
    return json({ connection: publicConnection(connection) });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте токен");
    return error(cause instanceof Error ? cause.message : "Не удалось подключить Telegram", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  await prisma.crmChannelConnection.deleteMany({
    where: { playbookId: id, type: "TELEGRAM" },
  });
  await writeLog({
    type: "crm_channel",
    message: `От навыка «${playbook.name}» отключён Telegram`,
    agentId: playbook.agentId,
    meta: { playbookId: id },
  });
  return json({ ok: true });
}
