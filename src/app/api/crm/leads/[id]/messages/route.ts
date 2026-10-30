import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { crmLeadForAgent } from "@/lib/crm";
import {
  applyInboundAutomation,
  messageStatusForSendMode,
  outboxStatusForSendMode,
} from "@/lib/crmAutomation";

type Params = { params: Promise<{ id: string }> };

const messageSchema = z.object({
  agentId: z.string().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  channel: z.enum(["MANUAL", "TELEGRAM", "EMAIL", "INSTAGRAM"]).default("MANUAL"),
  body: z.string().trim().min(1, "Введите сообщение").max(30_000),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = messageSchema.parse(await req.json());
    const lead = await crmLeadForAgent(id, body.agentId);
    if (lead instanceof Response) return lead;

    const telegramConnections =
      body.channel === "TELEGRAM"
        ? await prisma.crmChannelConnection.findMany({
            where: {
              playbookId: lead.playbookId,
              type: { in: ["TELEGRAM_ACCOUNT", "TELEGRAM"] },
              status: "CONNECTED",
            },
          })
        : [];
    const telegramConnection =
      telegramConnections.find((item) => item.type === "TELEGRAM_ACCOUNT") ??
      telegramConnections.find((item) => item.type === "TELEGRAM") ??
      null;
    let telegramThreadId = "";
    const emailConnection =
      body.channel === "EMAIL"
        ? await prisma.crmChannelConnection.findUnique({
            where: { playbookId_type: { playbookId: lead.playbookId, type: "EMAIL" } },
          })
        : null;
    let emailThreadId = "";
    const instagramConnection =
      body.channel === "INSTAGRAM"
        ? await prisma.crmChannelConnection.findUnique({
            where: { playbookId_type: { playbookId: lead.playbookId, type: "INSTAGRAM" } },
          })
        : null;
    let instagramThreadId = "";
    if (body.channel === "TELEGRAM" && lead.playbook.channelTelegramEnabled === false) {
      return error("Telegram выключен в настройках навыка");
    }
    if (body.channel === "EMAIL" && lead.playbook.channelEmailEnabled === false) {
      return error("Email выключен в настройках навыка");
    }
    if (body.channel === "TELEGRAM" && !telegramConnection) {
      return error("Telegram не подключён к этому навыку");
    }
    if (body.channel === "EMAIL" && emailConnection?.status !== "CONNECTED") {
      return error("Email не подключён к этому навыку");
    }
    if (body.channel === "TELEGRAM" && body.direction === "OUTBOUND") {
      const existing = await prisma.crmConversation.findUnique({
        where: { leadId_channel: { leadId: id, channel: "TELEGRAM" } },
        select: { externalThreadId: true },
      });
      telegramThreadId = existing?.externalThreadId ?? "";
      if (!telegramThreadId && telegramConnection?.type === "TELEGRAM_ACCOUNT") {
        telegramThreadId = lead.telegram.trim().replace(/^@/, "");
      }
      if (!telegramThreadId) {
        return error("Укажите Telegram username клиента или дождитесь его входящего сообщения");
      }
    }
    if (body.channel === "INSTAGRAM" && instagramConnection?.status !== "CONNECTED") {
      return error("Instagram не подключён к этому навыку");
    }
    if (body.channel === "INSTAGRAM" && body.direction === "OUTBOUND") {
      const existing = await prisma.crmConversation.findUnique({
        where: { leadId_channel: { leadId: id, channel: "INSTAGRAM" } },
        select: { externalThreadId: true },
      });
      instagramThreadId = existing?.externalThreadId ?? "";
      if (!instagramThreadId) return error("Сначала дождитесь входящего сообщения в Instagram Direct");
    }
    if (body.channel === "EMAIL" && body.direction === "OUTBOUND") {
      const existing = await prisma.crmConversation.findUnique({
        where: { leadId_channel: { leadId: id, channel: "EMAIL" } },
        select: { externalThreadId: true },
      });
      emailThreadId = existing?.externalThreadId || lead.email.trim().toLowerCase();
      if (!emailThreadId) return error("Укажите email клиента");
    }

    const now = new Date();
    const status =
      body.direction === "OUTBOUND"
        ? messageStatusForSendMode(lead.playbook.sendMode)
        : lead.playbook.status === "RUNNING"
          ? "RECEIVED"
          : "WAITING_AGENT";

    const message = await prisma.$transaction(async (tx) => {
      const conversation = await tx.crmConversation.upsert({
        where: { leadId_channel: { leadId: id, channel: body.channel } },
        create: {
          leadId: id,
          channel: body.channel,
          externalThreadId: telegramThreadId || emailThreadId || instagramThreadId,
          externalContext:
            body.channel === "EMAIL"
              ? JSON.stringify({ subject: lead.playbook.product || "Предложение" })
              : "{}",
          lastMessageAt: now,
        },
        update: {
          lastMessageAt: now,
          ...(telegramThreadId || emailThreadId || instagramThreadId
            ? { externalThreadId: telegramThreadId || emailThreadId || instagramThreadId }
            : {}),
        },
      });
      const created = await tx.crmMessage.create({
        data: {
          conversationId: conversation.id,
          direction: body.direction,
          status,
          body: body.body,
        },
      });
      const deliveryConnection = telegramConnection ?? emailConnection ?? instagramConnection;
      if (body.direction === "OUTBOUND" && deliveryConnection) {
        const outboxStatus = outboxStatusForSendMode(lead.playbook.sendMode);
        await tx.crmOutboxMessage.create({
          data: {
            connectionId: deliveryConnection.id,
            conversationId: conversation.id,
            messageId: created.id,
            body: body.body,
            status: outboxStatus,
            approvedAt: outboxStatus === "APPROVED" ? now : null,
            nextAttemptAt: now,
          },
        });
      }
      await tx.salesLead.update({
        where: { id },
        data: {
          lastContactAt: now,
          stage: lead.stage === "NEW" ? "COMMUNICATING" : lead.stage,
        },
      });
      return created;
    });

    if (body.direction === "INBOUND") {
      await applyInboundAutomation(id, body.body);
    }

    return json({ message, status }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Проверьте сообщение");
    return error("Не удалось добавить сообщение", 500);
  }
}
