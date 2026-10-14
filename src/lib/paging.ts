export const PAGE_SIZE = 50;

export function clampPage(page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safe = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { page: safe, pages, total, pageSize: PAGE_SIZE };
}

export function slicePage<T>(items: T[], page: number) {
  const meta = clampPage(page, items.length);
  const start = (meta.page - 1) * PAGE_SIZE;
  return { items: items.slice(start, start + PAGE_SIZE), ...meta };
}

/** Every word must appear somewhere in the joined text. */
export function matchesWords(q: string, ...parts: Array<string | number | null | undefined>) {
  const words = q.trim().toLocaleLowerCase("ru").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = parts
    .filter((part) => part != null && String(part) !== "")
    .join("\n")
    .toLocaleLowerCase("ru");
  return words.every((word) => hay.includes(word));
}

export function readListQuery(url: URL) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  return { page, q };
}

function wordVariants(word: string) {
  const lower = word.toLocaleLowerCase("ru");
  const upper = word.toLocaleUpperCase("ru");
  const cap = lower.slice(0, 1).toLocaleUpperCase("ru") + lower.slice(1);
  return [...new Set([word, lower, upper, cap])];
}

/** SQLite has no case-insensitive Unicode LIKE, so each word is matched in a few spellings. */
export function wordsWhere(fields: string[], q: string) {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return {};
  return {
    AND: words.map((word) => ({
      OR: wordVariants(word).flatMap((variant) =>
        fields.map((field) => ({ [field]: { contains: variant } })),
      ),
    })),
  };
}
