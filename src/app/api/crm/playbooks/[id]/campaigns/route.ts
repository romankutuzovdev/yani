import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import {
  syncCampaignFromContactLists,
  type ContactListChannel,
} from "@/lib/crmContactLists";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1).max(160),
  subject: z.string().trim().max(300).optional(),
  bodyMode: z.enum(["TEMPLATE", "PROMPT"]).optional(),
  bodyTemplate: z.string().trim().min(1).max(20_000),
  /** @deprecated use emailDailyLimit */
  dailyLimit: z.number().int().min(1).max(500).optional(),
  emailDailyLimit: z.number().int().min(1).max(500).optional(),
  telegramDailyLimit: z.number().int().min(1).max(500).optional(),
  intervalSeconds: z.number().int().min(10).max(86_400).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  importJobId: z.string().optional(),
  leadIds: z.array(z.string().min(1)).max(5_000).optional(),
  contactListIds: z.array(z.string().min(1)).max(100).optional(),
  onlyNewWithEmail: z.boolean().optional(),
  /** Which channels to create. Default: derived from selected lists / email legacy. */
  channels: z.array(z.enum(["EMAIL", "TELEGRAM"])).min(1).max(2).optional(),
});

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const campaigns = await prisma.crmCampaign.findMany({
    where: { playbookId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: {
      _count: { select: { items: true } },
      items: {
        select: { status: true },
      },
    },
  });
  return json({
    campaigns: campaigns.map((campaign) => {
      const counts = campaign.items.reduce(
        (acc, item) => {
          acc[item.status] = (acc[item.status] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const { items: _items, ...rest } = campaign;
      return { ...rest, counts };
    }),
  });
}

async function createChannelCampaign(opts: {
  playbookId: string;
  channel: ContactListChannel;
  name: string;
  subject: string;
  bodyMode: string;
  bodyTemplate: string;
  dailyLimit: number;
  intervalSeconds: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
  importJobId: string;
  contactListIds: string[];
  leadIds: string[];
  now: Date;
}) {
  const whereLead =
    opts.channel === "EMAIL"
      ? { playbookId: opts.playbookId, id: { in: opts.leadIds }, email: { not: "" } }
      : { playbookId: opts.playbookId, id: { in: opts.leadIds }, telegram: { not: "" } };

  const leads = opts.leadIds.length
    ? await prisma.salesLead.findMany({ where: whereLead, select: { id: true } })
    : [];

  const created = await prisma.$transaction(async (tx) => {
    const campaign = await tx.crmCampaign.create({
      data: {
        playbookId: opts.playbookId,
        name: opts.name,
        channel: opts.channel,
        subject: opts.channel === "EMAIL" ? opts.subject : "",
        bodyMode: opts.bodyMode,
        bodyTemplate: opts.bodyTemplate,
        dailyLimit: opts.dailyLimit,
        intervalSeconds: opts.intervalSeconds,
        quietHoursStart: opts.quietHoursStart,
        quietHoursEnd: opts.quietHoursEnd,
        timezone: opts.timezone,
        importJobId: opts.importJobId,
        contactListIds: JSON.stringify(opts.contactListIds),
        status: "DRAFT",
      },
    });
    if (leads.length) {
      await tx.crmCampaignItem.createMany({
        data: leads.map((lead, index) => ({
          campaignId: campaign.id,
          leadId: lead.id,
          status: "PENDING",
          scheduledAt: new Date(opts.now.getTime() + index * opts.intervalSeconds * 1000),
        })),
      });
    }
    return campaign;
  });

  if (opts.contactListIds.length) {
    await syncCampaignFromContactLists(created.id, opts.now);
  }

  return prisma.crmCampaign.findUnique({
    where: { id: created.id },
    include: { _count: { select: { items: true } } },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = createSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;

    const listIds = [...new Set(body.contactListIds ?? [])];
    const lists = listIds.length
      ? await prisma.crmContactList.findMany({
          where: { id: { in: listIds }, playbookId: playbook.id },
        })
      : [];
    if (listIds.length && lists.length !== listIds.length) {
      return error("Некоторые списки не найдены", 404);
    }

    let channels: ContactListChannel[] = body.channels?.length
      ? (body.channels as ContactListChannel[])
      : lists.length
        ? ([...new Set(lists.map((list) => list.channel))] as ContactListChannel[])
        : ["EMAIL"];

    channels = channels.filter((channel) => {
      if (channel === "EMAIL") return playbook.channelEmailEnabled !== false;
      return playbook.channelTelegramEnabled !== false;
    });
    if (!channels.length) return error("Нет доступных каналов для кампании", 400);

    const emailConnection = channels.includes("EMAIL")
      ? await prisma.crmChannelConnection.findUnique({
          where: { playbookId_type: { playbookId: playbook.id, type: "EMAIL" } },
        })
      : null;
    if (channels.includes("EMAIL") && emailConnection?.status !== "CONNECTED") {
      return error("Сначала подключите email в настройках навыка", 400);
    }

    if (channels.includes("TELEGRAM")) {
      const tg = await prisma.crmChannelConnection.findFirst({
        where: {
          playbookId: playbook.id,
          type: "TELEGRAM_ACCOUNT",
          status: "CONNECTED",
        },
      });
      if (!tg) {
        return error("Для Telegram-рассылки подключите аккаунт Telegram в настройках навыка", 400);
      }
    }

    let leadIds = body.leadIds ?? [];
    if (body.importJobId) {
      const job = await prisma.crmImportJob.findFirst({
        where: { id: body.importJobId, playbookId: playbook.id, status: "IMPORTED" },
      });
      if (!job) return error("Импорт не найден или ещё не применён", 404);
      const report = JSON.parse(job.reportJson) as { createdLeadIds?: string[] };
      leadIds = report.createdLeadIds ?? [];
    } else if (!listIds.length && (body.onlyNewWithEmail || !leadIds.length)) {
      const leads = await prisma.salesLead.findMany({
        where: {
          playbookId: playbook.id,
          stage: "NEW",
          email: { not: "" },
        },
        select: { id: true },
        take: 5_000,
      });
      leadIds = leads.map((lead) => lead.id);
    }

    const now = new Date();
    const intervalSeconds = body.intervalSeconds ?? 90;
    const emailLimit = body.emailDailyLimit ?? body.dailyLimit ?? 40;
    const telegramLimit = body.telegramDailyLimit ?? body.dailyLimit ?? 40;
    const baseName = body.name;
    const created = [];

    for (const channel of channels) {
      const channelListIds = lists.filter((list) => list.channel === channel).map((list) => list.id);
      if (listIds.length && !channelListIds.length && !leadIds.length) continue;

      const campaign = await createChannelCampaign({
        playbookId: playbook.id,
        channel,
        name:
          channels.length > 1
            ? `${baseName} · ${channel === "EMAIL" ? "Email" : "Telegram"}`
            : baseName,
        subject: body.subject ?? "",
        bodyMode: body.bodyMode ?? "PROMPT",
        bodyTemplate: body.bodyTemplate,
        dailyLimit: channel === "EMAIL" ? emailLimit : telegramLimit,
        intervalSeconds,
        quietHoursStart: body.quietHoursStart ?? null,
        quietHoursEnd: body.quietHoursEnd ?? null,
        timezone: body.timezone ?? "Europe/Minsk",
        importJobId: body.importJobId ?? "",
        contactListIds: channelListIds,
        leadIds,
        now,
      });
      if (campaign) created.push(campaign);
    }

    if (!created.length) {
      return error("Нет контактов для очереди (проверьте списки и каналы)");
    }

    const empty = created.filter((campaign) => (campaign?._count.items ?? 0) === 0);
    if (empty.length === created.length) {
      return error("В выбранных списках нет контактов для отправки");
    }

    return json(
      { campaign: created[0], campaigns: created },
      { status: 201 },
    );
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось создать кампанию", 500);
  }
}
