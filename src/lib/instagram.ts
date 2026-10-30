import { createHash, createHmac, timingSafeEqual } from "crypto";

const IG_GRAPH = "https://graph.instagram.com/v21.0";
const FB_GRAPH = "https://graph.facebook.com/v21.0";

export type InstagramProfile = {
  id: string;
  userId: string;
  username: string;
  accessToken: string;
  host: "instagram" | "facebook";
};

export function instagramVerifyToken() {
  const configured = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim();
  if (configured) return configured;
  const secret = process.env.JWT_SECRET || "yani";
  return createHash("sha256").update(`yani-instagram:${secret}`).digest("hex").slice(0, 32);
}

export function instagramWebhookUrl() {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://yani.by").replace(/\/$/, "");
  return `${base}/api/crm/instagram/webhook`;
}

export function verifyInstagramSignature(rawBody: string, header: string | null) {
  const secret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clipInstagramText(text: string) {
  let out = "";
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 990) return `${out}…`;
    out += char;
    bytes += size;
  }
  return out;
}

export function normalizeInstagramToken(raw: string) {
  const compact = raw.trim().replace(/^bearer\s+/i, "").replace(/\s+/g, "");
  const match = compact.match(/[A-Za-z0-9][A-Za-z0-9._-]{30,}/);
  return match?.[0] ?? compact;
}

function instagramTokenError(message: string) {
  if (/cannot parse access token|invalid oauth/i.test(message)) {
    return "Instagram не распознал эту строку как токен. Нужен токен доступа аккаунта из сценария Instagram в Meta. Маркер вебхука и секрет приложения не подходят.";
  }
  if (/nonexisting field \(instagram_business_account\)/i.test(message)) {
    return "Этот Facebook-ключ не видит Instagram. Сгенерируйте маркер в шаге «2. Сгенерируйте маркеры доступа» после добавления аккаунта Instagram, либо привяжите профессиональный Instagram к Facebook Page.";
  }
  return message || "Instagram не принял токен";
}

async function graphGet<T>(base: string, path: string, token: string, fields?: string) {
  const url = new URL(`${base}/${path}`);
  if (fields) url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(instagramTokenError(payload.error?.message || ""));
  return payload;
}

async function instagramLoginProfile(accessToken: string): Promise<InstagramProfile> {
  const payload = await graphGet<{ id?: string; user_id?: string; username?: string }>(
    IG_GRAPH,
    "me",
    accessToken,
    "id,username",
  );
  if (!payload.id) throw new Error("Instagram не принял токен");
  let userId = "";
  try {
    const idPayload = await graphGet<{ user_id?: string }>(IG_GRAPH, "me", accessToken, "user_id");
    userId = String(idPayload.user_id || "");
  } catch {
    userId = "";
  }
  return {
    id: String(payload.id),
    userId: userId || String(payload.id),
    username: payload.username || "",
    accessToken,
    host: "instagram",
  };
}

type PageRow = { id?: string; name?: string; access_token?: string };

async function pageInstagramAccount(pageId: string, token: string) {
  for (const fields of [
    "instagram_business_account{id,username}",
    "connected_instagram_account{id,username}",
  ]) {
    try {
      const page = await graphGet<{
        instagram_business_account?: { id?: string; username?: string };
        connected_instagram_account?: { id?: string; username?: string };
      }>(FB_GRAPH, pageId, token, fields);
      const ig = page.instagram_business_account ?? page.connected_instagram_account;
      if (ig?.id) return ig;
    } catch {
      /* try next field */
    }
  }
  return null;
}

async function facebookLoginProfile(accessToken: string): Promise<InstagramProfile> {
  let pages: PageRow[] = [];
  try {
    const listed = await graphGet<{ data?: PageRow[] }>(FB_GRAPH, "me/accounts", accessToken, "id,name,access_token");
    pages = listed.data ?? [];
  } catch (cause) {
    throw new Error(
      cause instanceof Error
        ? cause.message
        : "Не удалось получить Facebook Page по этому ключу. Нужны права на страницы или маркер Instagram из шага 2.",
    );
  }

  for (const page of pages) {
    if (!page.id) continue;
    const lookupToken = page.access_token || accessToken;
    const ig = await pageInstagramAccount(page.id, lookupToken);
    if (!ig?.id) continue;
    return {
      id: String(ig.id),
      userId: String(ig.id),
      username: ig.username || "",
      accessToken: page.access_token || accessToken,
      host: "facebook",
    };
  }

  if (!pages.length) {
    throw new Error(
      "У этого Facebook-ключа нет страниц. Откройте шаг «2. Сгенерируйте маркеры доступа», добавьте Instagram-аккаунт и скопируйте маркер оттуда (часто начинается с IG).",
    );
  }
  throw new Error(
    "К вашим Facebook Page не привязан профессиональный Instagram. В настройках страницы Facebook подключите Instagram и сгенерируйте маркер заново.",
  );
}

export async function instagramGetMe(accessToken: string): Promise<InstagramProfile> {
  if (accessToken.startsWith("IG")) return instagramLoginProfile(accessToken);
  const errors: string[] = [];
  try {
    return await facebookLoginProfile(accessToken);
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }
  try {
    return await instagramLoginProfile(accessToken);
  } catch (cause) {
    errors.push(cause instanceof Error ? cause.message : String(cause));
  }
  throw new Error(errors[0] || "Instagram не принял токен");
}

export async function instagramSendText(
  accessToken: string,
  igUserId: string,
  recipientId: string,
  text: string,
  host: "instagram" | "facebook" = accessToken.startsWith("IG") ? "instagram" : "facebook",
) {
  const base = host === "instagram" ? IG_GRAPH : FB_GRAPH;
  const response = await fetch(`${base}/${encodeURIComponent(igUserId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text: clipInstagramText(text) },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Instagram HTTP ${response.status}`);
  }
  return payload.message_id || "";
}
