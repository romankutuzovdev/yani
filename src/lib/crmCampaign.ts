import { prisma } from "@/lib/db";
import {
  messageStatusForSendMode,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";
import {
  isQuietHour,
  localDayKey,
  renderCampaignTemplate,
} from "@/lib/crmImport";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function processCampaignQueue(now = new Date()) {
  const campaigns = await prisma.crmCampaign.findMany({
    where: { status: "RUNNING", channel: "EMAIL" },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  for (const campaign of campaigns) {
    if (isQuietHour(now, campaign.timezone, campaign.quietHoursStart, campaign.quietHoursEnd)) {
      continue;
    }

    const day = localDayKey(now, campaign.timezone);
    let sentToday = campaign.sentToday;
    if (campaign.sentTodayDate !== day) {
      sentToday = 0;
      await prisma.crmCampaign.update({
        where: { id: campaign.id },
        data: { sentToday: 0, sentTodayDate: day },
      });
    }
    if (sentToday >= campaign.dailyLimit) continue;

    const connection = await prisma.crmChannelConnection.findUnique({
      where: {
        playbookId_type: { playbookId: campaign.playbookId, type: "EMAIL" },
      },
      include: { playbook: { select: { sendMode: true, status: true } } },
    });
    if (!connection || connection.status !== "CONNECTED") continue;
    if (connection.playbook.status !== "RUNNING") continue;

    const item = await prisma.crmCampaignItem.findFirst({
      where: {
        campaignId: campaign.id,
        status: "PENDING",
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true },
    });
    if (!item) {
      const pending = await prisma.crmCampaignItem.count({
        where: { campaignId: campaign.id, status: "PENDING" },
      });
      if (!pending) {
        await prisma.crmCampaign.update({
          where: { id: campaign.id },
          data: { status: "COMPLETED", stoppedAt: now },
        });
      }
      continue;
    }

    const claimed = await prisma.crmCampaignItem.updateMany({
      where: { id: item.id, status: "PENDING" },
      data: { status: "QUEUED" },
    });
    if (!claimed.count) continue;

    if (!item.lead.email.trim()) {
      await prisma.crmCampaignItem.update({
        where: { id: item.id },
        data: { status: "SKIPPED", error: "Нет email", processedAt: now },
      });
      continue;
    }

    if (item.lead.agentPaused) {
      await prisma.crmCampaignItem.update({
        where: { id: item.id },
        data: {
          status: "SKIPPED",
          error: "Менеджер взял карточку на себя",
          processedAt: now,
        },
      });
      continue;
    }

    try {
      const body = renderCampaignTemplate(campaign.bodyTemplate, item.lead);
      const subject = renderCampaignTemplate(campaign.subject, item.lead);
      const outboxStatus = outboxStatusForSendMode(connection.playbook.sendMode);
      const messageStatus = messageStatusForSendMode(connection.playbook.sendMode);

      await prisma.$transaction(async (tx) => {
        const conversation = await tx.crmConversation.upsert({
          where: {
            leadId_channel: { leadId: item.leadId, channel: "EMAIL" },
          },
          create: {
            leadId: item.leadId,
            channel: "EMAIL",
            externalThreadId: item.lead.email,
            externalContext: JSON.stringify({
              subject,
              firstContact: true,
              campaignId: campaign.id,
            }),
            lastMessageAt: now,
          },
          update: {
            externalThreadId: item.lead.email,
            lastMessageAt: now,
          },
        });

        const context = parseJson<Record<string, unknown>>(conversation.externalContext, {});
        if (!context.subject || context.firstContact) {
          await tx.crmConversation.update({
            where: { id: conversation.id },
            data: {
              externalContext: JSON.stringify({
                ...context,
                subject,
                firstContact: true,
                campaignId: campaign.id,
              }),
            },
          });
        }

        const message = await tx.crmMessage.create({
          data: {
            conversationId: conversation.id,
            direction: "OUTBOUND",
            status: messageStatus,
            body,
          },
        });
        const outbox = await tx.crmOutboxMessage.create({
          data: {
            connectionId: connection.id,
            conversationId: conversation.id,
            messageId: message.id,
            body,
            status: outboxStatus,
            approvedAt: outboxStatus === "APPROVED" ? now : null,
            nextAttemptAt: now,
          },
        });
        await tx.crmCampaignItem.update({
          where: { id: item.id },
          data: {
            status: "SENT",
            outboxId: outbox.id,
            processedAt: now,
            error: "",
          },
        });
        await tx.salesLead.update({
          where: { id: item.leadId },
          data: {
            ...(item.lead.stage === "NEW" ? { stage: "COMMUNICATING" } : {}),
            lastContactAt: now,
          },
        });
      });

      sentToday += 1;
      await prisma.crmCampaign.update({
        where: { id: campaign.id },
        data: { sentToday, sentTodayDate: day, updatedAt: now },
      });

      const next = await prisma.crmCampaignItem.findFirst({
        where: { campaignId: campaign.id, status: "PENDING" },
        orderBy: { scheduledAt: "asc" },
      });
      if (next) {
        const minAt = new Date(now.getTime() + campaign.intervalSeconds * 1000);
        if (next.scheduledAt < minAt) {
          await prisma.crmCampaignItem.update({
            where: { id: next.id },
            data: { scheduledAt: minAt },
          });
        }
      } else {
        await prisma.crmCampaign.update({
          where: { id: campaign.id },
          data: { status: "COMPLETED", stoppedAt: now },
        });
      }
    } catch (cause) {
      await prisma.crmCampaignItem.update({
        where: { id: item.id },
        data: {
          status: "FAILED",
          error: cause instanceof Error ? cause.message.slice(0, 1000) : "Ошибка кампании",
          processedAt: now,
        },
      });
    }
  }
}
