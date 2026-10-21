import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import { decryptCrmSecret, encryptCrmSecret } from "@/lib/crmSecrets";
import {
  finishTelegramAccountAuth,
  resendTelegramAccountCode,
  startTelegramAccountAuth,
  type TelegramAccountSecret,
} from "@/lib/telegramAccount";

type Params = { params: Promise<{ id: string }> };

const startSchema = z.object({
  action: z.literal("START"),
  agentId: z.string().optional(),
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().trim().regex(/^[a-fA-F0-9]{32}$/, "API Hash должен содержать 32 символа"),
  phone: z.string().trim().regex(/^\+\d{8,15}$/, "Телефон укажите в международном формате"),
});

const verifySchema = z.object({
  action: z.literal("VERIFY"),
  agentId: z.string().optional(),
  code: z.string().trim().regex(/^\d{4,8}$/, "Введите код Telegram"),
  password: z.string().max(200).optional(),
});

const resendSchema = z.object({
  action: z.literal("RESEND"),
  agentId: z.string().optional(),
});

const inputSchema = z.discriminatedUnion("action", [startSchema, verifySchema, resendSchema]);

function publicConnection(connection: {
  id: string;
  status: string;
  config: string;
  lastError: string;
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
    phoneMasked: config.phoneMasked ?? "",
    username: config.username ?? "",
    firstName: config.firstName ?? "",
    codeViaApp: config.codeViaApp ?? true,
    delivery: config.delivery ?? (config.codeViaApp ? "APP" : "UNKNOWN"),
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
  };
}

function maskedPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : "•••";
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const connection = await prisma.crmChannelConnection.findUnique({
    where: { playbookId_type: { playbookId: id, type: "TELEGRAM_ACCOUNT" } },
  });
  return json({ connection: publicConnection(connection) });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const input = inputSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, input.agentId);
    if (playbook instanceof Response) return playbook;

    if (input.action === "START") {
      const auth = await startTelegramAccountAuth(input);
      const connection = await prisma.crmChannelConnection.upsert({
        where: { playbookId_type: { playbookId: id, type: "TELEGRAM_ACCOUNT" } },
        create: {
          playbookId: id,
          type: "TELEGRAM_ACCOUNT",
          status: "CODE_REQUIRED",
          encryptedSecret: encryptCrmSecret(JSON.stringify(auth)),
          config: JSON.stringify({
            phoneMasked: maskedPhone(input.phone),
            codeViaApp: auth.isCodeViaApp,
            delivery: auth.delivery,
          }),
        },
        update: {
          status: "CODE_REQUIRED",
          encryptedSecret: encryptCrmSecret(JSON.stringify(auth)),
          config: JSON.stringify({
            phoneMasked: maskedPhone(input.phone),
            codeViaApp: auth.isCodeViaApp,
            delivery: auth.delivery,
          }),
          lastError: "",
        },
      });
      return json({ connection: publicConnection(connection) });
    }

    if (input.action === "RESEND") {
      const connection = await prisma.crmChannelConnection.findUnique({
        where: { playbookId_type: { playbookId: id, type: "TELEGRAM_ACCOUNT" } },
      });
      if (!connection || connection.status === "CONNECTED") {
        return error("Сначала запросите код входа");
      }
      const secret = JSON.parse(decryptCrmSecret(connection.encryptedSecret)) as TelegramAccountSecret;
      const resent = await resendTelegramAccountCode(secret, true);
      const updated = await prisma.crmChannelConnection.update({
        where: { id: connection.id },
        data: {
          status: "CODE_REQUIRED",
          encryptedSecret: encryptCrmSecret(JSON.stringify({
            apiId: resent.apiId,
            apiHash: resent.apiHash,
            phone: resent.phone,
            phoneCodeHash: resent.phoneCodeHash,
            session: resent.session,
          })),
          config: JSON.stringify({
            phoneMasked: maskedPhone(resent.phone),
            codeViaApp: resent.isCodeViaApp,
            delivery: resent.delivery,
          }),
          lastError: "",
        },
      });
      return json({
        connection: publicConnection(updated),
        delivery: resent.delivery,
        hint:
          resent.delivery === "SMS"
            ? "Новый код отправлен по SMS"
            : resent.delivery === "APP"
              ? "Новый код отправлен в приложение Telegram: откройте чат «Telegram»"
              : "Новый код запрошен. Проверьте Telegram и SMS",
      });
    }

    const connection = await prisma.crmChannelConnection.findUnique({
      where: { playbookId_type: { playbookId: id, type: "TELEGRAM_ACCOUNT" } },
    });
    if (!connection) return error("Сначала запросите код Telegram");
    const secret = JSON.parse(decryptCrmSecret(connection.encryptedSecret)) as TelegramAccountSecret;
    const result = await finishTelegramAccountAuth(secret, input.code, input.password);
    if (result.passwordRequired) {
      const updated = await prisma.crmChannelConnection.update({
        where: { id: connection.id },
        data: { status: "PASSWORD_REQUIRED" },
      });
      return json({ connection: publicConnection(updated), passwordRequired: true });
    }

    const updatedSecret: TelegramAccountSecret = {
      ...secret,
      phoneCodeHash: "",
      session: result.session,
    };
    const updated = await prisma.crmChannelConnection.update({
      where: { id: connection.id },
      data: {
        status: "CONNECTED",
        encryptedSecret: encryptCrmSecret(JSON.stringify(updatedSecret)),
        config: JSON.stringify({
          phoneMasked: maskedPhone(secret.phone),
          username: result.user.username,
          firstName: result.user.firstName,
          userId: result.user.id,
        }),
        lastError: "",
      },
    });
    await writeLog({
      type: "crm_channel",
      message: `К навыку «${playbook.name}» подключён Telegram-аккаунт @${result.user.username || result.user.id}`,
      agentId: playbook.agentId,
      meta: { playbookId: id, connectionId: updated.id },
    });
    return json({ connection: publicConnection(updated) });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте данные");
    return error(cause instanceof Error ? cause.message : "Не удалось подключить аккаунт", 400);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  await prisma.crmChannelConnection.deleteMany({
    where: { playbookId: id, type: "TELEGRAM_ACCOUNT" },
  });
  await writeLog({
    type: "crm_channel",
    message: `От навыка «${playbook.name}» отключён Telegram-аккаунт`,
    agentId: playbook.agentId,
    meta: { playbookId: id },
  });
  return json({ ok: true });
}
