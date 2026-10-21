export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  chat: { id: number; type: string; username?: string; first_name?: string; last_name?: string };
  from?: TelegramUser;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  business_message?: TelegramMessage & { business_connection_id?: string };
  business_connection?: {
    id: string;
    user: TelegramUser;
    user_chat_id: number;
    date: number;
    is_enabled: boolean;
    rights?: { can_reply?: boolean; can_read_messages?: boolean };
  };
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export async function telegramRequest<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 35_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const payload = await response.json() as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description || `Telegram API: HTTP ${response.status}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export function telegramGetMe(token: string) {
  return telegramRequest<TelegramUser>(token, "getMe", {}, 12_000);
}

export function telegramGetUpdates(token: string, offset: number) {
  return telegramRequest<TelegramUpdate[]>(token, "getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message", "business_connection", "business_message"],
  }, 32_000);
}

export function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  businessConnectionId?: string,
) {
  return telegramRequest<TelegramMessage>(token, "sendMessage", {
    chat_id: chatId,
    text,
    ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
    disable_web_page_preview: true,
  }, 15_000);
}
