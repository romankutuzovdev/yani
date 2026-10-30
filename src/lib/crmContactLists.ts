import { prisma } from "@/lib/db";
import { leadIdentities, normalizeEmail, normalizeTelegram } from "@/lib/crm";

export type ContactListChannel = "EMAIL" | "TELEGRAM";

export type ContactListContactInput = {
  displayName?: string;
  company?: string;
  email?: string;
  phone?: string;
  telegram?: string;
  notes?: string;
};

function parseListIds(raw: string): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  } catch {
    return [];
  }
}

export function normalizeContactForChannel(
  channel: ContactListChannel,
  input: ContactListContactInput,
) {
  const email = normalizeEmail(input.email ?? "") || (input.email ?? "").trim().toLowerCase();
  const telegramRaw = (input.telegram ?? "").trim();
  const telegram = telegramRaw
    ? `@${normalizeTelegram(telegramRaw)}`.replace(/^@@/, "@")
    : "";
  const displayName = (input.displayName ?? "").trim();
  const company = (input.company ?? "").trim();
  const phone = (input.phone ?? "").trim();
  const notes = (input.notes ?? "").trim();

  if (channel === "EMAIL" && !email) {
    return { ok: false as const, error: "Нужен email" };
  }
  if (channel === "TELEGRAM" && !telegram) {
    return { ok: false as const, error: "Нужен Telegram username" };
  }

  return {
    ok: true as const,
    contact: {
      displayName,
      company,
      email: channel === "EMAIL" ? email : email || "",
      phone,
      telegram: channel === "TELEGRAM" ? telegram : telegram || "",
      notes,
    },
  };
}

/** Upsert a SalesLead from a list contact; returns lead id. */
export async function upsertLeadFromContactListItem(opts: {
  playbookId: string;
  channel: ContactListChannel;
  contact: {
    displayName: string;
    company: string;
    email: string;
    phone: string;
    telegram: string;
    notes: string;
  };
}) {
  const identities = leadIdentities(opts.contact).filter((identity) => {
    if (opts.channel === "EMAIL") return identity.type === "EMAIL";
    return identity.type === "TELEGRAM";
  });
  if (!identities.length) return null;

  const existing = await prisma.leadIdentity.findFirst({
    where: {
      playbookId: opts.playbookId,
      OR: identities.map((identity) => ({ type: identity.type, value: identity.value })),
    },
    select: { leadId: true },
  });
  if (existing) {
    const data: {
      displayName?: string;
      company?: string;
      email?: string;
      phone?: string;
      telegram?: string;
      notes?: string;
    } = {};
    if (opts.contact.displayName) data.displayName = opts.contact.displayName;
    if (opts.contact.company) data.company = opts.contact.company;
    if (opts.contact.phone) data.phone = opts.contact.phone;
    if (opts.contact.notes) data.notes = opts.contact.notes;
    if (opts.channel === "EMAIL") data.email = opts.contact.email;
    if (opts.channel === "TELEGRAM") data.telegram = opts.contact.telegram;
    if (Object.keys(data).length) {
      await prisma.salesLead.update({ where: { id: existing.leadId }, data });
    }
    return existing.leadId;
  }

  const lead = await prisma.salesLead.create({
    data: {
      playbookId: opts.playbookId,
      displayName: opts.contact.displayName,
      company: opts.contact.company,
      email: opts.contact.email,
      phone: opts.contact.phone,
      telegram: opts.contact.telegram,
      notes: opts.contact.notes,
      stage: "NEW",
    },
  });
  await prisma.leadIdentity.createMany({
    data: leadIdentities(opts.contact).map((identity) => ({
      playbookId: opts.playbookId,
      leadId: lead.id,
      ...identity,
    })),
  });
  return lead.id;
}

const SYNC_BATCH = 500;

/**
 * Pull new contacts from linked lists into a campaign queue.
 * One call adds up to 500 so a 16k list finishes across worker ticks
 * instead of dying inside one HTTP request.
 */
export async function syncCampaignFromContactLists(campaignId: string, now = new Date()) {
  const campaign = await prisma.crmCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      playbookId: true,
      channel: true,
      contactListIds: true,
      intervalSeconds: true,
      status: true,
    },
  });
  if (!campaign) return { added: 0, remaining: false };
  if (!["RUNNING", "PAUSED", "DRAFT", "COMPLETED"].includes(campaign.status)) {
    return { added: 0, remaining: false };
  }

  const listIds = parseListIds(campaign.contactListIds);
  if (!listIds.length) return { added: 0, remaining: false };

  const channel = (campaign.channel === "TELEGRAM" ? "TELEGRAM" : "EMAIL") as ContactListChannel;
  const identityType = channel === "EMAIL" ? "EMAIL" : "TELEGRAM";
  const lists = await prisma.crmContactList.findMany({
    where: { id: { in: listIds }, playbookId: campaign.playbookId, channel },
    select: {
      contacts: {
        select: {
          displayName: true,
          company: true,
          email: true,
          phone: true,
          telegram: true,
          notes: true,
        },
      },
    },
  });
  if (!lists.length) return { added: 0, remaining: false };

  const [existing, identities, queuedCount] = await Promise.all([
    prisma.crmCampaignItem.findMany({
      where: { campaignId: campaign.id },
      select: { leadId: true },
    }),
    prisma.leadIdentity.findMany({
      where: { playbookId: campaign.playbookId, type: identityType },
      select: { value: true, leadId: true },
    }),
    prisma.crmCampaignItem.count({ where: { campaignId: campaign.id } }),
  ]);
  const haveLead = new Set(existing.map((item) => item.leadId));
  const leadByKey = new Map(identities.map((row) => [row.value, row.leadId]));

  const pending: Array<{ leadId: string }> = [];
  let seenPastBatch = false;
  for (const list of lists) {
    for (const raw of list.contacts) {
      const normalized = normalizeContactForChannel(channel, raw);
      if (!normalized.ok) continue;
      const key = channel === "EMAIL" ? normalized.contact.email : normalizeTelegram(normalized.contact.telegram);
      if (!key) continue;
      let leadId = leadByKey.get(key) ?? "";
      if (leadId && haveLead.has(leadId)) continue;
      if (pending.length >= SYNC_BATCH) {
        seenPastBatch = true;
        break;
      }
      if (!leadId) {
        leadId = (await upsertLeadFromContactListItem({
          playbookId: campaign.playbookId,
          channel,
          contact: normalized.contact,
        })) ?? "";
        if (!leadId) continue;
        leadByKey.set(key, leadId);
      }
      if (haveLead.has(leadId)) continue;
      haveLead.add(leadId);
      pending.push({ leadId });
    }
    if (seenPastBatch) break;
  }

  if (!pending.length) return { added: 0, remaining: false };

  for (const [index, item] of pending.entries()) {
    try {
      await prisma.crmCampaignItem.create({
        data: {
          campaignId: campaign.id,
          leadId: item.leadId,
          status: "PENDING",
          scheduledAt: new Date(now.getTime() + (queuedCount + index) * campaign.intervalSeconds * 1000),
        },
      });
    } catch {
      /* unique race — already queued */
    }
  }

  if (campaign.status === "COMPLETED") {
    await prisma.crmCampaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING", stoppedAt: null, updatedAt: now },
    });
  }

  return { added: pending.length, remaining: seenPastBatch || pending.length >= SYNC_BATCH };
}

export async function syncRunningCampaignsFromLists(now = new Date()) {
  const campaigns = await prisma.crmCampaign.findMany({
    where: {
      status: { in: ["DRAFT", "RUNNING", "PAUSED", "COMPLETED"] },
      NOT: { contactListIds: "[]" },
    },
    select: { id: true },
    take: 20,
  });
  let added = 0;
  for (const campaign of campaigns) {
    for (let pass = 0; pass < 8; pass += 1) {
      const result = await syncCampaignFromContactLists(campaign.id, now);
      added += result.added;
      if (!result.remaining) break;
    }
  }
  return { added };
}
