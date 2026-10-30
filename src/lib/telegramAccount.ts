import { Api, TelegramClient } from "telegram";
import { LogLevel } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";

export type TelegramAccountSecret = {
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  session: string;
};

export type TelegramCodeDelivery = "APP" | "SMS" | "CALL" | "FLASH_CALL" | "UNKNOWN";

export type TelegramAuthStartResult = {
  apiId: number;
  apiHash: string;
  phone: string;
  phoneCodeHash: string;
  session: string;
  isCodeViaApp: boolean;
  delivery: TelegramCodeDelivery;
  nextDelivery: TelegramCodeDelivery | null;
  timeout: number;
};

function clientFor(secret: Pick<TelegramAccountSecret, "apiId" | "apiHash" | "session">) {
  const client = new TelegramClient(
    new StringSession(secret.session || ""),
    secret.apiId,
    secret.apiHash,
    {
      // TCP is more stable on VPS than WSS for auth/sendCode.
      connectionRetries: 8,
      useWSS: false,
      timeout: 45,
      requestRetries: 3,
      autoReconnect: true,
      deviceModel: "Yani CRM",
      systemVersion: "Linux",
      appVersion: "1.0",
      langCode: "ru",
      systemLangCode: "ru",
    },
  );
  // gramJS floods stderr with TIMEOUT during DC migrate/reconnect.
  client.setLogLevel(LogLevel.ERROR);
  return client;
}

function humanTelegramError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/PHONE_NUMBER_INVALID/i.test(message)) {
    return "Неверный номер. Укажите телефон в формате +375..., +7...";
  }
  if (/PHONE_NUMBER_FLOOD|FLOOD_WAIT|PHONE_CODE_FLOOD/i.test(message)) {
    return "Telegram ограничил отправку кода. Подождите 10–30 минут и попробуйте снова.";
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
  if (/TIMEOUT|ECONNRESET|Network/i.test(message)) {
    return "Сервер не достучался до Telegram (таймаут). Повторите через минуту.";
  }
  return message.slice(0, 400);
}

function deliveryFromType(type: { className?: string } | undefined, isCodeViaApp?: boolean): TelegramCodeDelivery {
  const typeName = type?.className ?? "";
  if (typeName.includes("Sms")) return "SMS";
  if (typeName.includes("FlashCall")) return "FLASH_CALL";
  if (typeName.includes("Call")) return "CALL";
  if (typeName.includes("App") || isCodeViaApp) return "APP";
  return isCodeViaApp ? "APP" : "UNKNOWN";
}

function parseSentCode(sent: Api.auth.TypeSentCode, apiId: number, apiHash: string, phone: string, session: string): TelegramAuthStartResult {
  if (sent instanceof Api.auth.SentCodeSuccess) {
    throw new Error("Telegram сообщил успешный вход без кода — перезапустите авторизацию");
  }
  const typed = sent as Api.auth.SentCode;
  const isCodeViaApp = typed.type instanceof Api.auth.SentCodeTypeApp;
  return {
    apiId,
    apiHash,
    phone,
    phoneCodeHash: typed.phoneCodeHash,
    session,
    isCodeViaApp,
    delivery: deliveryFromType(typed.type, isCodeViaApp),
    nextDelivery: typed.nextType ? deliveryFromType(typed.nextType) : null,
    timeout: Number(typed.timeout ?? 0),
  };
}

async function sendCodeRaw(
  client: TelegramClient,
  input: { apiId: number; apiHash: string; phone: string; forceSMS?: boolean },
) {
  let sent = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber: input.phone,
      apiId: input.apiId,
      apiHash: input.apiHash,
      settings: new Api.CodeSettings({
        allowFlashcall: false,
        currentNumber: true,
        // false при forceSMS — реже отдаёт код в APP, чаще SMS.
        allowAppHash: !input.forceSMS,
      }),
    }),
  );

  // forceSMS: после APP Telegram обычно даёт SMS через ResendCode с тем же hash.
  if (
    input.forceSMS &&
    !(sent instanceof Api.auth.SentCodeSuccess) &&
    !(sent.type instanceof Api.auth.SentCodeTypeSms)
  ) {
    sent = await client.invoke(
      new Api.auth.ResendCode({
        phoneNumber: input.phone,
        phoneCodeHash: (sent as Api.auth.SentCode).phoneCodeHash,
      }),
    );
  }

  return sent;
}

export async function startTelegramAccountAuth(input: {
  apiId: number;
  apiHash: string;
  phone: string;
  forceSMS?: boolean;
}): Promise<TelegramAuthStartResult> {
  const client = clientFor({ ...input, session: "" });
  try {
    await client.connect();
    const sent = await sendCodeRaw(client, input);
    const result = parseSentCode(
      sent,
      input.apiId,
      input.apiHash,
      input.phone,
      (client.session as StringSession).save(),
    );
    console.info(
      `[telegram-auth] phone=${input.phone} forceSMS=${Boolean(input.forceSMS)} delivery=${result.delivery} next=${result.nextDelivery ?? "-"}`,
    );
    return result;
  } catch (cause) {
    throw new Error(humanTelegramError(cause));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

export async function resendTelegramAccountCode(
  secret: TelegramAccountSecret,
  forceSMS = true,
): Promise<TelegramAuthStartResult> {
  const client = clientFor(secret);
  try {
    await client.connect();

    // 1) ResendCode по текущему hash — лучший способ сменить APP → SMS.
    if (secret.phoneCodeHash) {
      try {
        const resent = await client.invoke(
          new Api.auth.ResendCode({
            phoneNumber: secret.phone,
            phoneCodeHash: secret.phoneCodeHash,
          }),
        );
        const parsed = parseSentCode(
          resent,
          secret.apiId,
          secret.apiHash,
          secret.phone,
          (client.session as StringSession).save(),
        );
        console.info(
          `[telegram-auth] resend hash phone=${secret.phone} delivery=${parsed.delivery} next=${parsed.nextDelivery ?? "-"}`,
        );
        // Уже SMS / не APP — готово. Если нужен SMS, а снова APP — уходим в новый SendCode.
        if (!forceSMS || parsed.delivery !== "APP") {
          return parsed;
        }
      } catch (cause) {
        console.warn(
          "[telegram-auth] ResendCode failed:",
          cause instanceof Error ? cause.message : cause,
        );
      }
    }

    // 2) Новый SendCode (+ ResendCode если нужен SMS).
    await client.disconnect().catch(() => undefined);
    return await startTelegramAccountAuth({
      apiId: secret.apiId,
      apiHash: secret.apiHash,
      phone: secret.phone,
      forceSMS,
    });
  } catch (cause) {
    throw new Error(humanTelegramError(cause));
  } finally {
    await client.disconnect().catch(() => undefined);
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
      await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: secret.phone,
          phoneCodeHash: secret.phoneCodeHash,
          phoneCode: code.trim(),
        }),
      );
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
