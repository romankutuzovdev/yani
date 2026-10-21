import { prisma } from "@/lib/db";
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
  field: "displayName" | "company" | "email" | "phone" | "telegram";
  value: string;
  confidence: number;
  evidence: string;
};

export function extractContactsFromText(text: string): ExtractedField[] {
  const found: ExtractedField[] = [];
  const seen = new Set<string>();

  const push = (field: ExtractedField["field"], value: string, confidence: number, evidence: string) => {
    const key = `${field}:${value}`;
    if (!value || seen.has(key)) return;
    seen.add(key);
    found.push({ field, value, confidence, evidence });
  };

  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const email = normalizeEmail(match[0] ?? "");
    if (email) push("email", email, 0.95, match[0] ?? "");
  }

  for (const match of text.matchAll(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,32})\b|(?:^|[\s(,;])@([A-Za-z0-9_]{4,32})\b(?!\.[A-Za-z])/g)) {
    const username = normalizeTelegram(match[1] || match[2] || "");
    if (username) push("telegram", `@${username}`, 0.9, match[0] ?? "");
  }

  for (const match of text.matchAll(/(?:\+?\d[\d\s().-]{8,}\d)/g)) {
    const phone = normalizePhone(match[0] ?? "");
    if (phone.length >= 7) push("phone", phone, 0.85, match[0] ?? "");
  }

  const nameMatch = text.match(
    /(?:меня зовут|мое имя|моё имя|я\s*[-—:])\s*([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\s'-]{1,40})/i,
  );
  if (nameMatch?.[1]) {
    const name = nameMatch[1].replace(/[.,!;:].*$/, "").trim();
    if (name.split(/\s+/).length <= 4) push("displayName", name, 0.75, nameMatch[0]);
  }

  const companyMatch = text.match(
    /(?:компания|организация|фирма|работаю в|из компании)\s*[:«"']?\s*([A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\s.&«»"'-]{1,60})/i,
  );
  if (companyMatch?.[1]) {
    const company = companyMatch[1].replace(/[.,!;:].*$/, "").trim();
    push("company", company, 0.7, companyMatch[0]);
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
  stage: string;
  agentPaused: boolean;
};

export async function applyInboundAutomation(leadId: string, text: string, minConfidence = 0.7) {
  const lead = await prisma.salesLead.findUnique({ where: { id: leadId } });
  if (!lead) return { lead: null, changes: [] as string[] };

  const extracted = extractContactsFromText(text).filter((item) => item.confidence >= minConfidence);
  const patch: Partial<LeadLike> = {};
  const changes: Array<{
    field: string;
    oldValue: string;
    newValue: string;
    confidence: number;
    evidence: string;
  }> = [];

  for (const item of extracted) {
    const current = String(lead[item.field] ?? "").trim();
    if (current) continue;
    patch[item.field] = item.value as never;
    changes.push({
      field: item.field,
      oldValue: current,
      newValue: item.value,
      confidence: item.confidence,
      evidence: item.evidence,
    });
  }

  const nextStage = classifyLeadStage(text, lead.stage);
  if (nextStage && nextStage !== lead.stage) {
    // Don't auto-move CLIENT or ARCHIVED backwards except NEW → COMMUNICATING / READY.
    const order = ["NEW", "COMMUNICATING", "READY_TO_ORDER", "CLIENT", "ARCHIVED"] as const;
    const from = order.indexOf(lead.stage as (typeof order)[number]);
    const to = order.indexOf(nextStage);
    if (nextStage === "ARCHIVED" || to >= from) {
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
          oldValue: change.oldValue,
          newValue: change.newValue,
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
