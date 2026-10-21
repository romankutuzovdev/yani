import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { error, requireCabinet } from "@/lib/api";

export const CRM_STAGES = [
  "NEW",
  "COMMUNICATING",
  "READY_TO_ORDER",
  "CLIENT",
  "ARCHIVED",
] as const;

export type CrmStage = (typeof CRM_STAGES)[number];

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 ? digits : trimmed.toLowerCase();
}

export function normalizeTelegram(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export type LeadContactInput = {
  email?: string;
  phone?: string;
  telegram?: string;
};

export function leadIdentities(input: LeadContactInput) {
  const identities = [
    {
      type: "EMAIL",
      value: normalizeEmail(input.email ?? ""),
      originalValue: (input.email ?? "").trim(),
    },
    {
      type: "PHONE",
      value: normalizePhone(input.phone ?? ""),
      originalValue: (input.phone ?? "").trim(),
    },
    {
      type: "TELEGRAM",
      value: normalizeTelegram(input.telegram ?? ""),
      originalValue: (input.telegram ?? "").trim(),
    },
  ];
  return identities.filter((identity) => identity.value);
}

/** Resolve the CRM tenant. Admin may choose an agent; organization is pinned to orgAgentId. */
export async function resolveCrmAgentId(requestedAgentId?: string | null): Promise<string | NextResponse> {
  const cabinet = await requireCabinet();
  if (cabinet instanceof NextResponse) return cabinet;

  if (cabinet.orgAgentId) return cabinet.orgAgentId;

  const requested = requestedAgentId?.trim();
  const agent = requested
    ? await prisma.agent.findUnique({ where: { id: requested }, select: { id: true } })
    : await prisma.agent.findFirst({
        where: { enabled: true },
        orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
        select: { id: true },
      });
  if (!agent) return error("Сначала создайте агента", 404);
  return agent.id;
}

export async function crmPlaybookForAgent(playbookId: string, requestedAgentId?: string | null) {
  const agentId = await resolveCrmAgentId(requestedAgentId);
  if (agentId instanceof NextResponse) return agentId;
  const playbook = await prisma.salesPlaybook.findFirst({
    where: { id: playbookId, agentId },
  });
  if (!playbook) return error("Навык продажи не найден", 404);
  return playbook;
}

export async function crmLeadForAgent(leadId: string, requestedAgentId?: string | null) {
  const agentId = await resolveCrmAgentId(requestedAgentId);
  if (agentId instanceof NextResponse) return agentId;
  const lead = await prisma.salesLead.findFirst({
    where: { id: leadId, playbook: { agentId } },
    include: { playbook: true },
  });
  if (!lead) return error("Карточка не найдена", 404);
  return lead;
}
