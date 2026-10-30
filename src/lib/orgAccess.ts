import { randomInt } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { clampPlanPrice } from "@/lib/plan";

export type OrgProfile = {
  orgName?: string;
  orgUnp?: string;
  planName?: string;
  planMonthlyPrice?: number;
  salesEnabled?: boolean;
  salesPlanName?: string;
  salesPlanMonthlyPrice?: number;
  salesPlaybookLimit?: number;
  salesAgentLimit?: number;
};

type OrgSalesFields = {
  orgName: string;
  orgUnp: string;
  planName: string;
  planMonthlyPrice: number;
  salesEnabled: boolean;
  salesPlanName: string;
  salesPlanMonthlyPrice: number;
  salesPlaybookLimit: number;
  salesAgentLimit: number;
};

const ORG_DOMAIN = "yani.by";

function latinLocal(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
}

/** Login is the agent name, so a renamed agent is not stuck with an old slug like alex. */
export function orgLoginEmail(name: string, slug: string) {
  const local = latinLocal(name) || latinLocal(slug) || "agent";
  return `${local}@${ORG_DOMAIN}`;
}

export function makeOrgPassword() {
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = lower + upper + digits;
  const chars = [
    lower[randomInt(lower.length)],
    upper[randomInt(upper.length)],
    digits[randomInt(digits.length)],
  ];
  while (chars.length < 16) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const swap = chars[i];
    chars[i] = chars[j];
    chars[j] = swap;
  }
  return chars.join("");
}

function clampLimit(value: number | undefined, fallback: number, max = 10_000) {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

async function freeEmail(base: string, agentId: string) {
  let email = base;
  for (let n = 0; n < 30; n++) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (!existing || (existing.role === "ORG" && existing.orgAgentId === agentId)) return email;
    const at = base.indexOf("@");
    email = `${base.slice(0, at)}-${n + 2}${base.slice(at)}`;
  }
  throw new Error("Не удалось подобрать почту для доступа");
}

function orgFields(
  profile: OrgProfile | undefined,
  current: OrgSalesFields | null,
): OrgSalesFields {
  return {
    orgName: (profile?.orgName ?? current?.orgName ?? "").trim().slice(0, 200),
    orgUnp: (profile?.orgUnp ?? current?.orgUnp ?? "").trim().slice(0, 32),
    planName: (profile?.planName ?? current?.planName ?? "").trim().slice(0, 120),
    planMonthlyPrice: clampPlanPrice(profile?.planMonthlyPrice ?? current?.planMonthlyPrice ?? 0),
    salesEnabled: profile?.salesEnabled ?? current?.salesEnabled ?? false,
    salesPlanName: (profile?.salesPlanName ?? current?.salesPlanName ?? "").trim().slice(0, 120),
    salesPlanMonthlyPrice: clampPlanPrice(
      profile?.salesPlanMonthlyPrice ?? current?.salesPlanMonthlyPrice ?? 0,
    ),
    salesPlaybookLimit: clampLimit(
      profile?.salesPlaybookLimit ?? current?.salesPlaybookLimit,
      0,
    ),
    salesAgentLimit: clampLimit(profile?.salesAgentLimit ?? current?.salesAgentLimit, 1) || 1,
  };
}

/** Create a default sales playbook when CRM is turned on and none exist. */
export async function ensureDefaultSalesPlaybook(agentId: string) {
  const existing = await prisma.salesPlaybook.count({ where: { agentId } });
  if (existing > 0) return null;
  return prisma.salesPlaybook.create({
    data: {
      agentId,
      name: "Продажи",
      product: "",
      goals: "Квалифицировать лиды и доводить до сделки",
      communicationStyle: "дружелюбный, деловой, живой",
      restrictions: "Не выдумывать цены и условия, которых нет в материалах",
    },
  });
}

export async function getOrgSalesProfile(agentId: string) {
  return prisma.user.findFirst({
    where: { orgAgentId: agentId, role: "ORG" },
    select: {
      email: true,
      orgName: true,
      orgUnp: true,
      planName: true,
      planMonthlyPrice: true,
      salesEnabled: true,
      salesPlanName: true,
      salesPlanMonthlyPrice: true,
      salesPlaybookLimit: true,
      salesAgentLimit: true,
    },
  });
}

/** Creates or resets the organization login for one agent. Password is returned only here. */
export async function issueOrgAccess(agentId: string, profile?: OrgProfile) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true, slug: true },
  });
  if (!agent) return null;

  const password = makeOrgPassword();
  const passwordHash = await hashPassword(password);
  const current = await prisma.user.findFirst({
    where: { orgAgentId: agent.id, role: "ORG" },
  });

  const email = await freeEmail(orgLoginEmail(agent.name, agent.slug), agent.id);
  const fields = orgFields(profile, current);

  if (current) {
    await prisma.user.update({
      where: { id: current.id },
      data: { passwordHash, name: agent.name, email, ...fields },
    });
  } else {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken) {
      await prisma.user.update({
        where: { id: taken.id },
        data: { passwordHash, name: agent.name, role: "ORG", orgAgentId: agent.id, ...fields },
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          name: agent.name,
          role: "ORG",
          passwordHash,
          orgAgentId: agent.id,
          ...fields,
        },
      });
    }
  }

  let playbookCreated = false;
  if (fields.salesEnabled) {
    const created = await ensureDefaultSalesPlaybook(agent.id);
    playbookCreated = Boolean(created);
  }

  return { email, password, ...fields, reset: Boolean(current), playbookCreated };
}

export async function saveOrgProfile(agentId: string, profile: OrgProfile) {
  const current = await prisma.user.findFirst({
    where: { orgAgentId: agentId, role: "ORG" },
  });
  if (!current) return null;
  const fields = orgFields(profile, current);
  await prisma.user.update({
    where: { id: current.id },
    data: fields,
  });

  let playbookCreated = false;
  if (fields.salesEnabled) {
    const created = await ensureDefaultSalesPlaybook(agentId);
    playbookCreated = Boolean(created);
  }

  return { email: current.email, ...fields, playbookCreated };
}

export async function orgSkillForAgent(agentId: string, skillId: string) {
  const link = await prisma.agentSkill.findUnique({
    where: { agentId_skillId: { agentId, skillId } },
    include: { skill: true },
  });
  return link?.skill ?? null;
}

export async function assertOrgSalesPlaybookQuota(agentId: string) {
  const org = await prisma.user.findFirst({
    where: { orgAgentId: agentId, role: "ORG" },
    select: { salesEnabled: true, salesPlaybookLimit: true },
  });
  // Admin CRM without org login: no org quota.
  if (!org) return { ok: true as const, limit: 0, used: 0 };
  if (!org.salesEnabled) {
    return { ok: false as const, reason: "CRM продаж не включён для этой организации", limit: 0, used: 0 };
  }
  const used = await prisma.salesPlaybook.count({ where: { agentId } });
  const limit = org.salesPlaybookLimit;
  if (limit > 0 && used >= limit) {
    return {
      ok: false as const,
      reason: `Лимит навыков продаж: ${limit}. Обратитесь к администратору Yani.`,
      limit,
      used,
    };
  }
  return { ok: true as const, limit, used };
}
