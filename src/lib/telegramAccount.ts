import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

export type TelegramAccountSecret = {
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  session: string;
};

export type TelegramCodeDelivery = "APP" | "SMS" | "CALL" | "FLASH_CALL" | "UNKNOWN";

function clientFor(secret: Pick<TelegramAccountSecret, "apiId" | "apiHash" | "session">) {
  return new TelegramClient(
    new StringSession(secret.session || ""),
    secret.apiId,
    secret.apiHash,
    {
      connectionRetries: 5,
      useWSS: true,
      timeout: 20,
    },
  );
}

function humanTelegramError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/PHONE_NUMBER_INVALID/i.test(message)) {
    return "Неверный номер. Укажите телефон в формате +375..., +7...";
  }
  if (/PHONE_NUMBER_FLOOD|FLOOD_WAIT/i.test(message)) {
    return "Telegram ограничил отправку кода. Подождите несколько минут и попробуйте снова.";
  }
  if (/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/i.test(message)) {
    return "Неверные API ID / API Hash. Проверьте их на my.telegram.org";
  }
  if (/PHONE_CODE_EXPIRED/i.test(message)) {
    return "Код устарел. Нажмите «Отправить ещё раз» и введите новый код.";
  }
  if (/PHONE_CODE_INVALID/i.test(message)) {
    return "Неверный код. Проверьте цифры и попробуйте снова.";
  }
  if (/SESSION_PASSWORD_NEEDED/i.test(message)) {
    return "Нужен пароль двухэтапной аутентификации Telegram.";
  }
  return message.slice(0, 400);
}

function deliveryFromSent(sent: { isCodeViaApp?: boolean; type?: { className?: string } }): TelegramCodeDelivery {
  const typeName = sent.type?.className ?? "";
  if (typeName.includes("Sms")) return "SMS";
  if (typeName.includes("FlashCall")) return "FLASH_CALL";
  if (typeName.includes("Call")) return "CALL";
  if (typeName.includes("App") || sent.isCodeViaApp) return "APP";
  return sent.isCodeViaApp ? "APP" : "UNKNOWN";
}

export async function startTelegramAccountAuth(input: {
  apiId: number;
  apiHash: string;
  phone: string;
  forceSMS?: boolean;
}) {
  const client = clientFor({ ...input, session: "" });
  try {
    await client.connect();
    const sent = await client.sendCode(
      { apiId: input.apiId, apiHash: input.apiHash },
      input.phone,
      Boolean(input.forceSMS),
    );
    return {
      apiId: input.apiId,
      apiHash: input.apiHash,
      phone: input.phone,
      phoneCodeHash: sent.phoneCodeHash,
      session: (client.session as StringSession).save(),
      isCodeViaApp: Boolean(sent.isCodeViaApp),
      delivery: deliveryFromSent(sent),
    };
  } catch (cause) {
    throw new Error(humanTelegramError(cause));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export async function resendTelegramAccountCode(secret: TelegramAccountSecret, forceSMS = true) {
  // ResendCode часто не доставляет сообщение. Надёжнее запросить код заново.
  try {
    return await startTelegramAccountAuth({
      apiId: secret.apiId,
      apiHash: secret.apiHash,
      phone: secret.phone,
      forceSMS,
    });
  } catch (firstError) {
    // Если force SMS не прошёл, пробуем обычную доставку в приложение.
    if (forceSMS) {
      try {
        return await startTelegramAccountAuth({
          apiId: secret.apiId,
          apiHash: secret.apiHash,
          phone: secret.phone,
          forceSMS: false,
        });
      } catch {
        throw firstError;
      }
    }
    throw firstError;
  }
}

export async function finishTelegramAccountAuth(
  secret: TelegramAccountSecret,
  code: string,
  password?: string,
) {
  const client = clientFor(secret);
  try {
    await client.connect();
    try {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: secret.phone,
        phoneCodeHash: secret.phoneCodeHash,
        phoneCode: code.trim(),
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!/SESSION_PASSWORD_NEEDED/i.test(message)) {
        throw new Error(humanTelegramError(cause));
      }
      if (!password) return { passwordRequired: true as const };
      await client.signInWithPassword(
        { apiId: secret.apiId, apiHash: secret.apiHash },
        {
          password: async () => password,
          onError: async () => true,
        },
      );
    }
    const me = await client.getMe();
    return {
      passwordRequired: false as const,
      session: (client.session as StringSession).save(),
      user: {
        id: String(me.id),
        firstName: "firstName" in me ? me.firstName ?? "" : "",
        lastName: "lastName" in me ? me.lastName ?? "" : "",
        username: "username" in me ? me.username ?? "" : "",
        phone: secret.phone,
      },
    };
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("двухэтапной")) throw cause;
    throw new Error(humanTelegramError(cause));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export function createTelegramAccountClient(secret: TelegramAccountSecret) {
  return clientFor(secret);
}
