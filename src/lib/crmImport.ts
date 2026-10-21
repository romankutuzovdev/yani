import * as XLSX from "xlsx";
import {
  leadIdentities,
  normalizeEmail,
  normalizePhone,
  normalizeTelegram,
} from "@/lib/crm";

export const CRM_IMPORT_HEADERS = [
  "displayName",
  "company",
  "email",
  "phone",
  "telegram",
  "notes",
] as const;

export type CrmImportRow = {
  rowNumber: number;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  notes: string;
};

export type CrmImportPreviewRow = CrmImportRow & {
  status: "OK" | "DUPLICATE" | "SKIPPED";
  reason: string;
};

const HEADER_ALIASES: Record<string, (typeof CRM_IMPORT_HEADERS)[number]> = {
  displayname: "displayName",
  name: "displayName",
  "имя": "displayName",
  "фио": "displayName",
  company: "company",
  "компания": "company",
  "организация": "company",
  email: "email",
  "почта": "email",
  "e-mail": "email",
  phone: "phone",
  tel: "phone",
  telephone: "phone",
  "телефон": "phone",
  telegram: "telegram",
  tg: "telegram",
  "телеграм": "telegram",
  notes: "notes",
  note: "notes",
  "заметки": "notes",
  "комментарий": "notes",
};

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function mapHeader(raw: string): (typeof CRM_IMPORT_HEADERS)[number] | null {
  const key = normalizeHeader(raw);
  return HEADER_ALIASES[key] ?? null;
}

function cell(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value.trim()));
}

export function parseImportFile(buffer: Buffer, fileName: string): CrmImportRow[] {
  const lower = fileName.toLowerCase();
  let matrix: string[][];

  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];
    const raw = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    matrix = raw.map((line) => line.map((value) => cell(value)));
  } else {
    matrix = parseCsvText(buffer.toString("utf8"));
  }

  if (!matrix.length) return [];
  const headerRow = matrix[0] ?? [];
  const mapping = headerRow.map((header) => mapHeader(header));
  if (!mapping.some(Boolean)) {
    throw new Error(
      "Не найдены колонки. Нужны: displayName, company, email, phone, telegram, notes",
    );
  }

  const rows: CrmImportRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const line = matrix[i] ?? [];
    const mapped: Record<string, string> = {
      displayName: "",
      company: "",
      email: "",
      phone: "",
      telegram: "",
      notes: "",
    };
    mapping.forEach((key, index) => {
      if (!key) return;
      mapped[key] = cell(line[index]);
    });
    rows.push({
      rowNumber: i + 1,
      displayName: mapped.displayName,
      company: mapped.company,
      email: mapped.email,
      phone: mapped.phone,
      telegram: mapped.telegram,
      notes: mapped.notes,
    });
  }
  return rows;
}

export function buildImportPreview(
  rows: CrmImportRow[],
  existing: Array<{ type: string; value: string }>,
): CrmImportPreviewRow[] {
  const existingKeys = new Set(existing.map((item) => `${item.type}:${item.value}`));
  const seenInFile = new Set<string>();

  return rows.map((row) => {
    const identities = leadIdentities(row);
    if (!identities.length && !row.displayName && !row.company) {
      return { ...row, status: "SKIPPED", reason: "Пустая строка" };
    }
    if (!identities.length) {
      return {
        ...row,
        status: "SKIPPED",
        reason: "Нет email, телефона или Telegram",
      };
    }

    for (const identity of identities) {
      const key = `${identity.type}:${identity.value}`;
      if (existingKeys.has(key)) {
        return {
          ...row,
          status: "DUPLICATE",
          reason: `Уже есть в CRM (${identity.type.toLowerCase()})`,
        };
      }
      if (seenInFile.has(key)) {
        return {
          ...row,
          status: "DUPLICATE",
          reason: `Дубль внутри файла (${identity.type.toLowerCase()})`,
        };
      }
    }

    for (const identity of identities) {
      seenInFile.add(`${identity.type}:${identity.value}`);
    }

    return {
      ...row,
      email: normalizeEmail(row.email) || row.email,
      phone: normalizePhone(row.phone) || row.phone,
      telegram: row.telegram
        ? `@${normalizeTelegram(row.telegram)}`.replace(/^@@/, "@")
        : "",
      status: "OK",
      reason: "",
    };
  });
}

export function renderCampaignTemplate(
  template: string,
  lead: {
    displayName: string;
    company: string;
    email: string;
    phone: string;
    telegram: string;
  },
) {
  return template
    .replaceAll("{{name}}", lead.displayName || "коллеги")
    .replaceAll("{{company}}", lead.company || "")
    .replaceAll("{{email}}", lead.email || "")
    .replaceAll("{{phone}}", lead.phone || "")
    .replaceAll("{{telegram}}", lead.telegram || "");
}

export function localDayKey(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function localHour(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  } catch {
    return date.getUTCHours();
  }
}

/** Quiet hours can wrap midnight: start=22 end=8 means blocked from 22..23 and 0..7 */
export function isQuietHour(now: Date, timeZone: string, start: number | null, end: number | null) {
  if (start == null || end == null) return false;
  const hour = localHour(now, timeZone);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}
