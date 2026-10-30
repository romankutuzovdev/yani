import { prisma } from "@/lib/db";
import { createLLMProvider, defaultLLMModel, providerForModel } from "@/llm";
import {
  CRM_STAGES,
  leadIdentities,
  normalizeEmail,
  normalizePhone,
  normalizeTelegram,
  type CrmStage,
} from "@/lib/crm";

const READY_HINTS = [
  "хочу заказать",
  "готов заказать",
  "готовы заказать",
  "оформить заказ",
  "давайте договор",
  "пришлите счет",
  "пришлите счёт",
  "купить",
  "покупаем",
  "берем",
  "берём",
  "мне подходит",
  "давайте начнём",
  "давайте начнем",
  "ready to order",
  "want to buy",
  "let's proceed",
];

const ARCHIVE_HINTS = [
  "не интересно",
  "неактуально",
  "откажемся",
  "отказываемся",
  "не нужно",
  "stop",
  "unsubscribe",
];

export type ExtractedField = {
  field: "displayName" | "company" | "email" | "phone" | "telegram" | "notes";
  value: string;
  confidence: number;
  evidence: string;
};

export function extractContactsFromText(text: string): ExtractedField[] {
  const found: ExtractedField[] = [];
  const seen = new Set<string>();

  const push = (field: ExtractedField["field"], value: string, confidence: number, evidence: string) => {
    const key = `${field}:${value.toLowerCase()}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    found.push({ field, value, confidence, evidence });
  };

  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = normalizeEmail(match[0] ?? "");
    if (email) push("email", email, 0.95, match[0] ?? "");
  }

  for (const match of text.matchAll(
    /(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,32})\b|(?:^|[\s(,;])@([A-Za-z0-9_]{4,32})\b(?!\.[A-Za-z])/g,
  )) {
    const username = normalizeTelegram(match[1] || match[2] || "");
    if (username) push("telegram", `@${username}`, 0.9, match[0] ?? "");
  }

  for (const match of text.matchAll(/(?:\+?\d[\d\s().-]{8,}\d)/g)) {
    const phone = normalizePhone(match[0] ?? "");
    if (phone.length >= 7) push("phone", phone, 0.85, match[0] ?? "");
  }

  const namePatterns = [
    /(?:меня зовут|мое имя|моё имя|зовут меня)\s+([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,40})/i,
    /(?:^|[\n,.!?])\s*я\s+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+){0,2})(?=$|[\s,.;!?])/i,
    /(?:^|\n)\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,2})\s*[,.]?\s*(?:из|из г|компания|ооо|ип)/i,
  ];
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch?.[1]) {
      const name = nameMatch[1].replace(/[.,!;:].*$/, "").trim();
      if (name.split(/\s+/).length <= 4) {
        push("displayName", name, 0.8, nameMatch[0]);
        break;
      }
    }
  }

  const companyPatterns = [
    /(?:компания|организация|фирма|работаю в|работаю на|из компании|у нас\s+(?:в|в компании)?)\s*[:«"']?\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.&«»"'-]{1,60})/i,
    /\b((?:ООО|ОАО|ЗАО|ИП|ЧУП|УП)\s*[«"]?[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.&«»"'-]{1,50})/i,
  ];
  for (const pattern of companyPatterns) {
    const companyMatch = text.match(pattern);
    if (companyMatch?.[1]) {
      const company = companyMatch[1].replace(/[.,!;:].*$/, "").trim();
      if (company.length >= 2) {
        push("company", company, 0.8, companyMatch[0]);
        break;
      }
    }
  }

  return found;
}

export function classifyLeadStage(text: string, current: string): CrmStage | null {
  const lower = text.toLowerCase();
  if (ARCHIVE_HINTS.some((hint) => lower.includes(hint))) return "ARCHIVED";
  if (READY_HINTS.some((hint) => lower.includes(hint))) return "READY_TO_ORDER";
  if (current === "NEW" && text.trim()) return "COMMUNICATING";
  if (CRM_STAGES.includes(current as CrmStage)) return null;
  return null;
}

type LeadLike = {
  id: string;
  playbookId: string;
  displayName: string;
  company: string;
  email: string;
  phone: string;
  telegram: string;
  notes: string;
  stage: string;
  agentPaused: boolean;
};

type LlmEnrichment = {
  displayName?: string;
  company?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  noteFact?: string;
  stageHint?: "COMMUNICATING" | "READY_TO_ORDER" | "ARCHIVED" | null;
};

function parseJsonObject(raw: string): LlmEnrichment | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/\{[\s\S]*\}/);
  if (!fenced) return null;
  try {
    const parsed = JSON.parse(fenced[0]) as LlmEnrichment;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Ask the model to pull contact/qualification facts the regex may miss. */
async function enrichLeadWithLlm(input: {
  text: string;
  lead: LeadLike;
  qualificationQuestions: string;
  model?: string | null;
}): Promise<LlmEnrichment | null> {
  const model = input.model?.trim() || defaultLLMModel();
  try {
    const provider = createLLMProvider(providerForModel(model));
    const result = await provider.chat(
      [
        {
          role: "system",
          content:
            "Ты CRM-парсер. Из сообщения клиента извлеки факты для карточки. Ответь ТОЛЬКО JSON без markdown: " +
            '{"displayName":"","company":"","email":"","phone":"","telegram":"","noteFact":"","stageHint":null}. ' +
            "Пустую строку ставь если факта нет. noteFact — коротко что выяснили по квалификации (1 предложение). " +
            "stageHint: COMMUNICATING | READY_TO_ORDER | ARCHIVED | null. Не выдумывай.",
        },
        {
          role: "user",
          content: [
            `Текущая карточка: имя=${input.lead.displayName || "—"}; компания=${input.lead.company || "—"}; email=${input.lead.email || "—"}; phone=${input.lead.phone || "—"}; telegram=${input.lead.telegram || "—"}; stage=${input.lead.stage}`,
            input.qualificationQuestions
              ? `Вопросы квалификации навыка:\n${input.qualificationQuestions}`
              : "Вопросы квалификации не заданы.",
            `Сообщение клиента:\n${input.text.slice(0, 4000)}`,
          ].join("\n\n"),
        },
      ],
      { model, temperature: 0, maxTokens: 350 },
    );
    return parseJsonObject(result.content);
  } catch (cause) {
    console.warn(
      "[crm-automation] LLM enrich failed:",
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

function shouldWriteField(
  field: ExtractedField["field"],
  current: string,
  next: string,
  confidence: number,
) {
  const value = next.trim();
  if (!value) return false;
  if (field === "notes") return true;
  if (!current.trim()) return confidence >= 0.65;
  // Upgrade short Telegram-first-name style names when we learn a fuller one.
  if (field === "displayName" && confidence >= 0.85 && value.length > current.trim().length + 2) {
    return true;
  }
  // Allow stronger company overwrite when current is a stub.
  if (field === "company" && confidence >= 0.9 && current.trim().length <= 2) return true;
  return false;
}

function appendNote(existing: string, fact: string) {
  const clean = fact.replace(/\s+/g, " ").trim();
  if (!clean) return existing;
  if (existing.toLowerCase().includes(clean.toLowerCase())) return existing;
  const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
  const line = `[авто ${stamp}] ${clean}`;
  return existing.trim() ? `${existing.trim()}\n${line}` : line;
}

export async function applyInboundAutomation(leadId: string, text: string, minConfidence = 0.65) {
  const lead = await prisma.salesLead.findUnique({
    where: { id: leadId },
    include: {
      playbook: { select: { qualificationQuestions: true, agent: { select: { model: true } } } },
    },
  });
  if (!lead) return { lead: null, changes: [] as string[] };

  const extracted = extractContactsFromText(text).filter((item) => item.confidence >= minConfidence);
  const llm = await enrichLeadWithLlm({
    text,
    lead,
    qualificationQuestions: lead.playbook.qualificationQuestions,
    model: lead.playbook.agent.model,
  });

  if (llm) {
    const map: Array<[ExtractedField["field"], string | undefined, number]> = [
      ["displayName", llm.displayName, 0.88],
      ["company", llm.company, 0.88],
      ["email", llm.email, 0.92],
      ["phone", llm.phone, 0.9],
      ["telegram", llm.telegram, 0.9],
      ["notes", llm.noteFact, 0.95],
    ];
    for (const [field, raw, confidence] of map) {
      if (!raw?.trim()) continue;
      let value = raw.trim();
      if (field === "email") value = normalizeEmail(value);
      if (field === "phone") value = normalizePhone(value);
      if (field === "telegram") {
        const username = normalizeTelegram(value);
        value = username ? `@${username}` : "";
      }
      if (!value) continue;
      if (!extracted.some((item) => item.field === field && item.value.toLowerCase() === value.toLowerCase())) {
        extracted.push({ field, value, confidence, evidence: text.slice(0, 180) });
      }
    }
  }

  const patch: Partial<LeadLike> = {};
  const changes: Array<{
    field: string;
    oldValue: string;
    newValue: string;
    confidence: number;
    evidence: string;
  }> = [];

  let nextNotes = lead.notes;
  for (const item of extracted) {
    if (item.field === "notes") {
      const updatedNotes = appendNote(nextNotes, item.value);
      if (updatedNotes === nextNotes) continue;
      changes.push({
        field: "notes",
        oldValue: nextNotes,
        newValue: updatedNotes,
        confidence: item.confidence,
        evidence: item.evidence,
      });
      nextNotes = updatedNotes;
      patch.notes = updatedNotes;
      continue;
    }

    const current = String(lead[item.field] ?? "").trim();
    if (!shouldWriteField(item.field, current, item.value, item.confidence)) continue;
    patch[item.field] = item.value as never;
    changes.push({
      field: item.field,
      oldValue: current,
      newValue: item.value,
      confidence: item.confidence,
      evidence: item.evidence,
    });
  }

  let nextStage =
    (llm?.stageHint && CRM_STAGES.includes(llm.stageHint) ? llm.stageHint : null) ??
    classifyLeadStage(text, lead.stage);

  // If we learned company/name/contacts while talking — at least leave NEW.
  if (
    !nextStage &&
    lead.stage === "NEW" &&
    (patch.displayName || patch.company || patch.email || patch.phone || patch.telegram || patch.notes)
  ) {
    nextStage = "COMMUNICATING";
  }

  if (nextStage && nextStage !== lead.stage) {
    const order = ["NEW", "COMMUNICATING", "READY_TO_ORDER", "CLIENT", "ARCHIVED"] as const;
    const from = order.indexOf(lead.stage as (typeof order)[number]);
    const to = order.indexOf(nextStage);
    if (nextStage === "ARCHIVED" || (to >= 0 && from >= 0 && to >= from)) {
      patch.stage = nextStage;
      changes.push({
        field: "stage",
        oldValue: lead.stage,
        newValue: nextStage,
        confidence: 0.8,
        evidence: text.slice(0, 180),
      });
    }
  }

  if (!Object.keys(patch).length) return { lead, changes: [] as string[] };

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.salesLead.update({
      where: { id: leadId },
      data: {
        displayName: patch.displayName,
        company: patch.company,
        email: patch.email,
        phone: patch.phone,
        telegram: patch.telegram,
        notes: patch.notes,
        stage: patch.stage,
      },
    });

    if (patch.email || patch.phone || patch.telegram) {
      const identities = leadIdentities({
        email: next.email,
        phone: next.phone,
        telegram: next.telegram,
      });
      for (const identity of identities) {
        const conflict = await tx.leadIdentity.findFirst({
          where: {
            playbookId: lead.playbookId,
            type: identity.type,
            value: identity.value,
            leadId: { not: leadId },
          },
        });
        if (conflict) continue;
        await tx.leadIdentity.upsert({
          where: {
            playbookId_type_value: {
              playbookId: lead.playbookId,
              type: identity.type,
              value: identity.value,
            },
          },
          create: {
            playbookId: lead.playbookId,
            leadId,
            ...identity,
          },
          update: { leadId, originalValue: identity.originalValue },
        });
      }
    }

    if (changes.length) {
      await tx.leadFieldChange.createMany({
        data: changes.map((change) => ({
          leadId,
          field: change.field,
          oldValue: change.oldValue.slice(0, 500),
          newValue: change.newValue.slice(0, 500),
          source: "AUTO",
          confidence: change.confidence,
          evidence: change.evidence.slice(0, 500),
        })),
      });
    }

    return next;
  });

  return {
    lead: updated,
    changes: changes.map((change) => `${change.field}=${change.newValue}`),
  };
}

export function outboxStatusForSendMode(sendMode: string) {
  if (sendMode === "AUTO") return "APPROVED" as const;
  if (sendMode === "DRAFT_ONLY") return "DRAFT" as const;
  return "DRAFT" as const;
}

export function messageStatusForSendMode(sendMode: string) {
  if (sendMode === "AUTO") return "APPROVED" as const;
  return "DRAFT" as const;
}

/** 08:00 Europe/Minsk on the next calendar day — deferred outbound slot. */
export function nextOutboundMorning(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Minsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1, 5, 0, 0));
}
