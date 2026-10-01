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

/** Json/list fields stored as String or Json → string[] */
export function asStringArray(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asStringArray(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function jsonString(value: unknown, fallback: string = "{}"): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
}
