/** Europe/Minsk is UTC+3 year-round. */
const OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

export function minskParts(date: Date) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function startOfMinskDay(date = new Date()) {
  const { year, month, day } = minskParts(date);
  return new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
}

export function startOfMinskMonth(date = new Date()) {
  const { year, month } = minskParts(date);
  return new Date(Date.UTC(year, month - 1, 1) - OFFSET_MS);
}

export function minskDayKey(date: Date) {
  const { year, month, day } = minskParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Parse YYYY-MM-DD as a Minsk calendar day → [start, end) UTC instants. */
export function minskDayBounds(dayKey: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = new Date(Date.UTC(year, month - 1, day) - OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function minskDayLabel(dayKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
  if (!match) return dayKey;
  const day = Number(match[3]);
  const month = Number(match[2]);
  const year = Number(match[1]);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

export type UsageBucket = "day" | "week" | "month" | "quarter" | "year";

const BUCKETS = new Set<UsageBucket>(["day", "week", "month", "quarter", "year"]);

export function parseUsageBucket(value: string | null): UsageBucket {
  if (value && BUCKETS.has(value as UsageBucket)) return value as UsageBucket;
  return "day";
}

function isoWeek(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { weekYear: date.getUTCFullYear(), week };
}

/** Period key and label for a usage row, in Europe/Minsk. */
export function usagePeriod(date: Date, bucket: UsageBucket) {
  const { year, month, day } = minskParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (bucket === "day") {
    return {
      key: `${year}-${pad(month)}-${pad(day)}`,
      label: `${day} ${MONTHS[month - 1]} ${year}`,
    };
  }
  if (bucket === "month") {
    return { key: `${year}-${pad(month)}`, label: `${MONTHS[month - 1]} ${year}` };
  }
  if (bucket === "quarter") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    return { key: `${year}-Q${quarter}`, label: `${quarter} квартал ${year}` };
  }
  if (bucket === "year") {
    return { key: String(year), label: String(year) };
  }
  const { weekYear, week } = isoWeek(year, month, day);
  return { key: `${weekYear}-W${pad(week)}`, label: `${weekYear}, неделя ${week}` };
}
