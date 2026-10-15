/** Shown in public chat when the LLM or network fails. */
export const CHAT_UNAVAILABLE =
  "Пока не получается ответить — сервис временно недоступен. Попробуйте чуть позже.";

const KEEP_PREFIX =
  /^(Отменено|Достигнут лимит|Доступ|Слишком частые|Месячный|Дневной|Лимит|Сейчас много запросов)/i;

/** Map provider/network dumps to a short visitor-facing line. */
export function toChatUserMessage(raw?: string | null): string {
  const text = (raw ?? "").trim();
  if (!text) return CHAT_UNAVAILABLE;
  if (KEEP_PREFIX.test(text) && !/vibecode|hoster|stream error|invalid_request|\{"error"/i.test(text)) {
    return text;
  }
  if (
    /vibecode|hoster|deepseek|openai|anthropic|gemini|qwen|stream error|invalid[_ ]request|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|API key|Unauthorized|rate.?limit|timeout|socket|\{"error"|error \d{3}/i.test(
      text,
    )
  ) {
    return CHAT_UNAVAILABLE;
  }
  if (/[а-яё]/i.test(text) && text.length < 220 && !/\{"/.test(text)) {
    return text;
  }
  return CHAT_UNAVAILABLE;
}
