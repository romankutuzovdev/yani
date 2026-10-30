import { mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { decryptCrmSecret, encryptCrmSecret } from "@/lib/crmSecrets";

const SETTINGS_FILE = path.join(process.cwd(), "prisma", "data", "yandex-search.json");

/** Yandex Search API sync web search, RUB per 1000 requests, VAT included (AI Studio, 2026). */
export const YANDEX_DAY_RUB_PER_1000 = 488;
export const YANDEX_NIGHT_RUB_PER_1000 = 366;

type StoredSettings = {
  apiKeyEnc?: string;
  folderId?: string;
  dayRubPer1000?: number;
  nightRubPer1000?: number;
};

export type YandexPublicSettings = {
  source: "admin" | "env" | "none";
  folderId: string;
  keyHint: string;
  dayRubPer1000: number;
  nightRubPer1000: number;
};

function readStored(): StoredSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

function writeStored(next: StoredSettings) {
  mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
}

function hint(key: string) {
  const trimmed = key.trim();
  if (trimmed.length < 4) return trimmed ? "••••" : "";
  return `••••${trimmed.slice(-4)}`;
}

function clampPrice(value: number, fallback: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return fallback;
  return Math.round(value * 100) / 100;
}

export function yandexPrices() {
  const stored = readStored();
  return {
    dayRubPer1000: clampPrice(stored.dayRubPer1000 ?? YANDEX_DAY_RUB_PER_1000, YANDEX_DAY_RUB_PER_1000),
    nightRubPer1000: clampPrice(
      stored.nightRubPer1000 ?? YANDEX_NIGHT_RUB_PER_1000,
      YANDEX_NIGHT_RUB_PER_1000,
    ),
  };
}

/** Moscow night window 00:00–07:59 is the cheaper Search API tariff. */
export function isYandexNight(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Moscow",
      hour: "numeric",
      hourCycle: "h23",
    }).format(date),
  );
  return hour < 8;
}

export function yandexRequestCostRub(date = new Date()) {
  const prices = yandexPrices();
  const perThousand = isYandexNight(date) ? prices.nightRubPer1000 : prices.dayRubPer1000;
  return perThousand / 1000;
}

export function yandexCredentials(): { apiKey: string; folderId: string; source: "admin" | "env" } | null {
  const stored = readStored();
  let adminKey = "";
  if (stored.apiKeyEnc) {
    try {
      adminKey = decryptCrmSecret(stored.apiKeyEnc).trim();
    } catch {
      adminKey = "";
    }
  }
  const adminFolder = stored.folderId?.trim() ?? "";
  if (adminKey && adminFolder) return { apiKey: adminKey, folderId: adminFolder, source: "admin" };
  const envKey = process.env.YANDEX_SEARCH_API_KEY?.trim() ?? "";
  const envFolder = process.env.YANDEX_FOLDER_ID?.trim() ?? "";
  if (envKey && envFolder) return { apiKey: envKey, folderId: envFolder, source: "env" };
  return null;
}

export function yandexPublicSettings(): YandexPublicSettings {
  const stored = readStored();
  const prices = yandexPrices();
  const creds = yandexCredentials();
  let keyHint = "";
  if (stored.apiKeyEnc) {
    try {
      keyHint = hint(decryptCrmSecret(stored.apiKeyEnc));
    } catch {
      keyHint = "не читается";
    }
  } else if (creds?.source === "env") {
    keyHint = hint(creds.apiKey);
  }
  return {
    source: creds?.source ?? "none",
    folderId: stored.folderId?.trim() || (creds?.source === "env" ? creds.folderId : ""),
    keyHint,
    dayRubPer1000: prices.dayRubPer1000,
    nightRubPer1000: prices.nightRubPer1000,
  };
}

export function saveYandexSettings(input: {
  apiKey?: string;
  folderId?: string;
  dayRubPer1000?: number;
  nightRubPer1000?: number;
  clearKey?: boolean;
}) {
  const current = readStored();
  const next: StoredSettings = { ...current };
  if (input.clearKey) delete next.apiKeyEnc;
  else if (input.apiKey?.trim()) next.apiKeyEnc = encryptCrmSecret(input.apiKey.trim());
  if (input.folderId !== undefined) next.folderId = input.folderId.trim();
  if (input.dayRubPer1000 !== undefined) {
    next.dayRubPer1000 = clampPrice(input.dayRubPer1000, YANDEX_DAY_RUB_PER_1000);
  }
  if (input.nightRubPer1000 !== undefined) {
    next.nightRubPer1000 = clampPrice(input.nightRubPer1000, YANDEX_NIGHT_RUB_PER_1000);
  }
  writeStored(next);
  return yandexPublicSettings();
}
