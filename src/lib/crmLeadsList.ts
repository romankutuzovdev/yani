import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const LIST_LIMIT = 250;
const PREVIEW_LEN = 120;

/** Board cards only — notes/instructions load when opening a lead. */
export const leadListSelect = {
  id: true,
  playbookId: true,
  displayName: true,
  company: true,
  email: true,
  phone: true,
  telegram: true,
  stage: true,
  agentPaused: true,
  urgentAt: true,
  urgentNote: true,
  lastContactAt: true,
  updatedAt: true,
  createdAt: true,
  replyCount: true,
  replySpendUsd: true,
  _count: { select: { conversations: true } },
} satisfies Prisma.SalesLeadSelect;

type LatestMessageRow = {
  conversationId: string;
  id: string;
  direction: string;
  status: string;
  body: string;
  createdAt: Date | string;
};

/** Fast board list: leads + one preview message without Prisma nested N+1. */
export async function listPlaybookLeads(playbookId: string) {
  const withDialogs = await prisma.salesLead.findMany({
    where: { playbookId, conversations: { some: {} } },
    orderBy: [{ lastContactAt: "desc" }, { updatedAt: "desc" }],
    take: LIST_LIMIT,
    select: leadListSelect,
  });
  const dialogIds = withDialogs.map((lead) => lead.id);
  const fresh = await prisma.salesLead.findMany({
    where: {
      playbookId,
      ...(dialogIds.length ? { id: { notIn: dialogIds } } : {}),
      conversations: { none: {} },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 80,
    select: leadListSelect,
  });
  const leads = [...withDialogs, ...fresh];
  if (!leads.length) return [];

  const leadIds = leads.map((lead) => lead.id);
  const conversations = await prisma.crmConversation.findMany({
    where: { leadId: { in: leadIds } },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    select: { id: true, leadId: true, channel: true, lastMessageAt: true },
  });

  const conversationByLead = new Map<string, (typeof conversations)[number]>();
  for (const conversation of conversations) {
    if (!conversationByLead.has(conversation.leadId)) {
      conversationByLead.set(conversation.leadId, conversation);
    }
  }

  const conversationIds = [...conversationByLead.values()].map((row) => row.id);
  const messageByConversation = new Map<string, LatestMessageRow>();
  if (conversationIds.length) {
    const rows = await prisma.$queryRaw<LatestMessageRow[]>`
      SELECT m.conversationId as conversationId, m.id as id, m.direction as direction,
             m.status as status, substr(m.body, 1, ${PREVIEW_LEN}) as body, m.createdAt as createdAt
      FROM CrmMessage m
      INNER JOIN (
        SELECT conversationId, MAX(createdAt) AS maxCreated
        FROM CrmMessage
        WHERE conversationId IN (${Prisma.join(conversationIds)})
        GROUP BY conversationId
      ) latest
        ON latest.conversationId = m.conversationId
       AND latest.maxCreated = m.createdAt
    `;
    for (const row of rows) {
      messageByConversation.set(row.conversationId, row);
    }
  }

  return leads.map((lead) => {
    const conversation = conversationByLead.get(lead.id);
    const message = conversation ? messageByConversation.get(conversation.id) : undefined;
    return {
      ...lead,
      conversations: conversation
        ? [
            {
              id: conversation.id,
              channel: conversation.channel,
              lastMessageAt: conversation.lastMessageAt,
              messages: message
                ? [
                    {
                      id: message.id,
                      direction: message.direction,
                      status: message.status,
                      body: message.body,
                      createdAt: message.createdAt,
                    },
                  ]
                : [],
            },
          ]
        : [],
    };
  });
}

export const playbookListSelect = {
  id: true,
  agentId: true,
  name: true,
  product: true,
  status: true,
  sendMode: true,
  channelTelegramEnabled: true,
  channelEmailEnabled: true,
  telegramSendIntervalSeconds: true,
  replyCount: true,
  replySpendUsd: true,
  updatedAt: true,
  createdAt: true,
  _count: { select: { leads: true, documents: true } },
} satisfies Prisma.SalesPlaybookSelect;
