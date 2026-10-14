/**
 * Chat model priority when the provider returns an upstream/transient failure.
 * DeepSeek first, then Gemini 3 Flash, then Grok.
 */
export const MODEL_FALLBACK_TOP = [
  "deepseek-v4-flash",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "gemini-3-flash-preview",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "grok-4-7",
  "grok-4-6",
  "grok-4-5",
] as const;

/** Prefer the agent/skill model, then the top list in order (no duplicates). */
export function modelAttempts(preferred?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  if (preferred) push(preferred);
  for (const id of MODEL_FALLBACK_TOP) push(id);
  return out;
}

/** Retry another model only on provider/network outages — not on bad payloads. */
export function isModelFailoverError(raw?: string | null): boolean {
  const text = (raw ?? "").trim();
  if (!text) return false;
  if (/invalid[_ ]request|stream_options|tool_calls|400/i.test(text) && !/\b(502|503|504)\b/.test(text)) {
    return false;
  }
  return /\b(502|503|504|429)\b|upstream|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|socket|overloaded|temporarily unavailable|rate.?limit|bad gateway|gateway timeout|service unavailable/i.test(
    text,
  );
}
