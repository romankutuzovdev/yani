import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1).max(160),
  subject: z.string().trim().min(1).max(300),
  bodyTemplate: z.string().trim().min(1).max(20_000),
  dailyLimit: z.number().int().min(1).max(500).optional(),
  intervalSeconds: z.number().int().min(10).max(86_400).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  importJobId: z.string().optional(),
  leadIds: z.array(z.string().min(1)).max(5_000).optional(),
  onlyNewWithEmail: z.boolean().optional(),
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

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = createSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;

    const emailConnection = await prisma.crmChannelConnection.findUnique({
      where: { playbookId_type: { playbookId: playbook.id, type: "EMAIL" } },
    });
    if (!emailConnection || emailConnection.status !== "CONNECTED") {
      return error("Сначала подключите email в настройках навыка", 400);
    }

    let leadIds = body.leadIds ?? [];
    if (body.importJobId) {
      const job = await prisma.crmImportJob.findFirst({
        where: { id: body.importJobId, playbookId: playbook.id, status: "IMPORTED" },
      });
      if (!job) return error("Импорт не найден или ещё не применён", 404);
      const report = JSON.parse(job.reportJson) as { createdLeadIds?: string[] };
      leadIds = report.createdLeadIds ?? [];
    } else if (body.onlyNewWithEmail || !leadIds.length) {
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

    const uniqueLeadIds = [...new Set(leadIds)];
    if (!uniqueLeadIds.length) return error("Нет контактов для кампании");

    const leads = await prisma.salesLead.findMany({
      where: {
        playbookId: playbook.id,
        id: { in: uniqueLeadIds },
        email: { not: "" },
      },
      select: { id: true },
    });
    if (!leads.length) return error("Нет контактов с email");

    const now = new Date();
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.crmCampaign.create({
        data: {
          playbookId: playbook.id,
          name: body.name,
          subject: body.subject,
          bodyTemplate: body.bodyTemplate,
          dailyLimit: body.dailyLimit ?? 40,
          intervalSeconds: body.intervalSeconds ?? 90,
          quietHoursStart: body.quietHoursStart ?? null,
          quietHoursEnd: body.quietHoursEnd ?? null,
          timezone: body.timezone ?? "Europe/Minsk",
          importJobId: body.importJobId ?? "",
          status: "DRAFT",
        },
      });
      await tx.crmCampaignItem.createMany({
        data: leads.map((lead, index) => ({
          campaignId: created.id,
          leadId: lead.id,
          status: "PENDING",
          scheduledAt: new Date(now.getTime() + index * (body.intervalSeconds ?? 90) * 1000),
        })),
      });
      return created;
    });

    const withCounts = await prisma.crmCampaign.findUnique({
      where: { id: campaign.id },
      include: { _count: { select: { items: true } } },
    });
    return json({ campaign: withCounts }, { status: 201 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось создать кампанию", 500);
  }
}
