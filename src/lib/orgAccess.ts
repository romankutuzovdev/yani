import { randomInt } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { clampPlanPrice } from "@/lib/plan";

type OrgProfile = {
  orgName?: string;
  orgUnp?: string;
  planName?: string;
  planMonthlyPrice?: number;
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
    return { email, password, ...fields, reset: true };
  }

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) {
    await prisma.user.update({
      where: { id: taken.id },
      data: { passwordHash, name: agent.name, role: "ORG", orgAgentId: agent.id, ...fields },
    });
    return { email, password, ...fields, reset: true };
  }

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
  return { email, password, ...fields, reset: false };
}

function orgFields(
  profile: OrgProfile | undefined,
  current: { orgName: string; orgUnp: string; planName: string; planMonthlyPrice: number } | null,
) {
  return {
    orgName: (profile?.orgName ?? current?.orgName ?? "").trim().slice(0, 200),
    orgUnp: (profile?.orgUnp ?? current?.orgUnp ?? "").trim().slice(0, 32),
    planName: (profile?.planName ?? current?.planName ?? "").trim().slice(0, 120),
    planMonthlyPrice: clampPlanPrice(profile?.planMonthlyPrice ?? current?.planMonthlyPrice ?? 0),
  };
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
  return { email: current.email, ...fields };
}

export async function orgSkillForAgent(agentId: string, skillId: string) {
  const link = await prisma.agentSkill.findUnique({
    where: { agentId_skillId: { agentId, skillId } },
    include: { skill: true },
  });
  return link?.skill ?? null;
}
