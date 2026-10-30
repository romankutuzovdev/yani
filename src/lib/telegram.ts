import path from "path";

export type TelegramUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id?: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  chat: { id: number; type: string; username?: string; first_name?: string; last_name?: string };
  from?: TelegramUser;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
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

/** Show “печатает…” in the Telegram chat while the agent prepares a reply. */
export function telegramSendChatAction(
  token: string,
  chatId: string,
  action: "typing" | "upload_document" | "upload_photo" = "typing",
  businessConnectionId?: string,
) {
  return telegramRequest<boolean>(token, "sendChatAction", {
    chat_id: chatId,
    action,
    ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
  }, 8_000);
}

export function telegramGetFile(token: string, fileId: string) {
  return telegramRequest<{ file_id: string; file_path?: string; file_size?: number }>(
    token,
    "getFile",
    { file_id: fileId },
    15_000,
  );
}

/** Download a bot-API file (document / photo) into a Buffer. */
export async function telegramDownloadFile(token: string, fileId: string) {
  const meta = await telegramGetFile(token, fileId);
  if (!meta.file_path) throw new Error("Telegram getFile: нет file_path");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${meta.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = meta.file_path.split("/").pop() || "file.bin";
  return { buffer, fileName, filePath: meta.file_path };
}

function telegramDisplayName(filePath: string, fileName?: string) {
  const raw = (fileName || "").split(/[/\\]/).pop()?.trim() || path.basename(filePath);
  return raw.replace(/[\r\n"]/g, "").slice(0, 180) || path.basename(filePath);
}

async function telegramSendMultipart(
  token: string,
  method: "sendPhoto" | "sendDocument",
  field: "photo" | "document",
  chatId: string,
  filePath: string,
  caption?: string,
  businessConnectionId?: string,
  fileName?: string,
) {
  const { readFile } = await import("fs/promises");
  const buffer = await readFile(filePath);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set(field, new Blob([new Uint8Array(buffer)]), telegramDisplayName(filePath, fileName));
  if (caption?.trim()) form.set("caption", caption.slice(0, 1024));
  if (businessConnectionId) form.set("business_connection_id", businessConnectionId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const payload = (await response.json()) as TelegramResponse<TelegramMessage>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new Error(payload.description || `Telegram ${method}: HTTP ${response.status}`);
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export function telegramSendPhotoFile(
  token: string,
  chatId: string,
  filePath: string,
  caption?: string,
  businessConnectionId?: string,
  fileName?: string,
) {
  return telegramSendMultipart(
    token,
    "sendPhoto",
    "photo",
    chatId,
    filePath,
    caption,
    businessConnectionId,
    fileName,
  );
}

export function telegramSendDocumentFile(
  token: string,
  chatId: string,
  filePath: string,
  caption?: string,
  businessConnectionId?: string,
  fileName?: string,
) {
  return telegramSendMultipart(
    token,
    "sendDocument",
    "document",
    chatId,
    filePath,
    caption,
    businessConnectionId,
    fileName,
  );
}
