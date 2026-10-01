import { createHash, randomBytes } from "crypto";

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_agent_${randomBytes(24).toString("hex")}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, 16),
  };
}

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
