import { isIP } from "net";

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\]|metadata\.google|169\.254\.)/i;

function isPrivateHostname(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (PRIVATE_HOST.test(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  const ipVersion = isIP(host);
  if (!ipVersion) return false;
  if (host === "0.0.0.0" || host === "::" || host === "::1") return true;
  if (ipVersion === 4) {
    const parts = host.split(".").map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export function assertPublicHttpUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Некорректный URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Разрешены только http/https");
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("Приватные и локальные адреса запрещены");
  }
  return parsed;
}

/** Strip HTML to readable plain text for LLM context. */
export function htmlToPlainText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|br|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function fetchPageText(input: {
  url: string;
  maxChars?: number;
  signal?: AbortSignal;
}) {
  const parsed = assertPublicHttpUrl(input.url);
  const maxChars = Math.min(Math.max(input.maxChars ?? 12_000, 1000), 40_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);
  const onAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": "YaniAgent/1.0 (+research)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 2_500_000) {
      throw new Error("Страница слишком большая");
    }
    const raw = buffer.toString("utf8");
    const isHtml = /html|xml/i.test(contentType) || /^\s*</.test(raw);
    const text = (isHtml ? htmlToPlainText(raw) : raw).slice(0, maxChars);
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {
      url: parsed.toString(),
      finalUrl: response.url || parsed.toString(),
      status: response.status,
      contentType,
      title: titleMatch ? htmlToPlainText(titleMatch[1] ?? "").slice(0, 200) : "",
      text,
      truncated: text.length >= maxChars,
    };
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
