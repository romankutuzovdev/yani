import { prisma } from "@/lib/db";
import {
  messageStatusForSendMode,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";
import { generateFirstTouchEmail } from "@/lib/crmGrounding";
import {
  isQuietHour,
  localDayKey,
  renderCampaignTemplate,
} from "@/lib/crmImport";
import { syncRunningCampaignsFromLists } from "@/lib/crmContactLists";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type CampaignChannel = "EMAIL" | "TELEGRAM";

async function findCampaignConnection(playbookId: string, channel: CampaignChannel) {
  if (channel === "EMAIL") {
    return prisma.crmChannelConnection.findUnique({
      where: { playbookId_type: { playbookId, type: "EMAIL" } },
      include: {
        playbook: {
          include: {
            documents: { where: { status: "READY" }, orderBy: { sortOrder: "asc" } },
            agent: { select: { model: true } },
          },
        },
      },
    });
  }
  const connections = await prisma.crmChannelConnection.findMany({
    where: {
      playbookId,
      type: { in: ["TELEGRAM_ACCOUNT", "TELEGRAM"] },
      status: "CONNECTED",
    },
    include: {
      playbook: {
        include: {
          documents: { where: { status: "READY" }, orderBy: { sortOrder: "asc" } },
          agent: { select: { model: true } },
        },
      },
    },
  });
  return (
    connections.find((item) => item.type === "TELEGRAM_ACCOUNT") ??
    connections.find((item) => item.type === "TELEGRAM") ??
    null
  );
}

function telegramThreadForLead(lead: { telegram: string }) {
  return lead.telegram.trim().replace(/^@/, "");
}

export async function processCampaignQueue(now = new Date()) {
  // New contacts added to linked lists while the campaign runs join the queue.
  await syncRunningCampaignsFromLists(now).catch(() => undefined);

  const campaigns = await prisma.crmCampaign.findMany({
    where: { status: "RUNNING", channel: { in: ["EMAIL", "TELEGRAM"] } },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });

  for (const campaign of campaigns) {
    const channel = (campaign.channel === "TELEGRAM" ? "TELEGRAM" : "EMAIL") as CampaignChannel;
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

    const connection = await findCampaignConnection(campaign.playbookId, channel);
    if (!connection || connection.status !== "CONNECTED") continue;
    if (channel === "TELEGRAM" && connection.type !== "TELEGRAM_ACCOUNT") {
      // Bot API cannot cold-message; only a linked personal account can.
      continue;
    }
    if (connection.playbook.status !== "RUNNING") continue;
    if (channel === "EMAIL" && connection.playbook.channelEmailEnabled === false) continue;
    if (channel === "TELEGRAM" && connection.playbook.channelTelegramEnabled === false) continue;

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

    const email = item.lead.email.trim();
    const telegramThread = telegramThreadForLead(item.lead);
    if (channel === "EMAIL" && !email) {
      await prisma.crmCampaignItem.update({
        where: { id: item.id },
        data: { status: "SKIPPED", error: "Нет email", processedAt: now },
      });
      continue;
    }
    if (channel === "TELEGRAM" && !telegramThread) {
      await prisma.crmCampaignItem.update({
        where: { id: item.id },
        data: { status: "SKIPPED", error: "Нет Telegram username", processedAt: now },
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
      const subject =
        channel === "EMAIL" ? renderCampaignTemplate(campaign.subject, item.lead) : "";
      let body = "";
      let attachmentsJson = "[]";
      if (campaign.bodyMode === "PROMPT") {
        const generated = await generateFirstTouchEmail({
          prompt: campaign.bodyTemplate,
          playbook: connection.playbook,
          lead: item.lead,
          documents: connection.playbook.documents,
          model: connection.playbook.agent.model,
        });
        body = generated.body;
        // Cold Telegram outreach with files triggers PEER_FLOOD; keep attachments for email only.
        attachmentsJson =
          channel === "EMAIL" ? JSON.stringify(generated.attachments) : "[]";
      } else {
        body = renderCampaignTemplate(campaign.bodyTemplate, item.lead);
      }
      if (!body.trim()) {
        await prisma.crmCampaignItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            error: channel === "EMAIL" ? "Пустой текст письма" : "Пустой текст сообщения",
            processedAt: now,
          },
        });
        continue;
      }
      const outboxStatus = outboxStatusForSendMode(connection.playbook.sendMode);
      const messageStatus = messageStatusForSendMode(connection.playbook.sendMode);
      const threadId = channel === "EMAIL" ? email : telegramThread;

      await prisma.$transaction(async (tx) => {
        const existing = await tx.crmConversation.findUnique({
          where: { leadId_channel: { leadId: item.leadId, channel } },
          select: { id: true, externalThreadId: true, externalContext: true },
        });
        const conversation = await tx.crmConversation.upsert({
          where: { leadId_channel: { leadId: item.leadId, channel } },
          create: {
            leadId: item.leadId,
            channel,
            externalThreadId: threadId,
            externalContext: JSON.stringify({
              ...(channel === "EMAIL" ? { subject } : {}),
              firstContact: true,
              campaignId: campaign.id,
            }),
            lastMessageAt: now,
          },
          update: {
            externalThreadId: existing?.externalThreadId || threadId,
            lastMessageAt: now,
          },
        });

        if (channel === "EMAIL") {
          const context = parseJson<Record<string, unknown>>(
            existing?.externalContext ?? conversation.externalContext,
            {},
          );
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
        }

        const message = await tx.crmMessage.create({
          data: {
            conversationId: conversation.id,
            direction: "OUTBOUND",
            status: messageStatus,
            body,
            attachments: attachmentsJson,
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
