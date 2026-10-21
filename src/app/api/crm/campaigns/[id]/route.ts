import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { resolveCrmAgentId } from "@/lib/crm";
import { writeCrmAudit } from "@/lib/crmAudit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  agentId: z.string().optional(),
  action: z.enum(["START", "PAUSE", "STOP"]),
});

async function campaignForAgent(campaignId: string, requestedAgentId?: string | null) {
  const agentId = await resolveCrmAgentId(requestedAgentId);
  if (agentId instanceof Response) return agentId;
  const campaign = await prisma.crmCampaign.findFirst({
    where: { id: campaignId, playbook: { agentId } },
    include: {
      _count: { select: { items: true } },
      items: { select: { status: true } },
    },
  });
  if (!campaign) return error("Кампания не найдена", 404);
  return campaign;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const campaign = await campaignForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (campaign instanceof Response) return campaign;
  const counts = campaign.items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const { items: _items, ...rest } = campaign;
  return json({ campaign: { ...rest, counts } });
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = actionSchema.parse(await req.json());
    const campaign = await campaignForAgent(id, body.agentId);
    if (campaign instanceof Response) return campaign;

    const now = new Date();
    if (body.action === "START") {
      if (campaign.status === "STOPPED" || campaign.status === "COMPLETED") {
        return error("Остановленную кампанию нельзя перезапустить");
      }
      const playbook = await prisma.salesPlaybook.findUnique({ where: { id: campaign.playbookId } });
      if (!playbook || playbook.status !== "RUNNING") {
        return error("Сначала запустите навык продажи");
      }
      const updated = await prisma.crmCampaign.update({
        where: { id },
        data: {
          status: "RUNNING",
          startedAt: campaign.startedAt ?? now,
          stoppedAt: null,
        },
      });
      await writeCrmAudit({
        playbookId: campaign.playbookId,
        action: "campaign.start",
        entityType: "CrmCampaign",
        entityId: id,
        summary: `Кампания «${campaign.name}» запущена`,
      });
      return json({ campaign: updated });
    }

    if (body.action === "PAUSE") {
      const updated = await prisma.crmCampaign.update({
        where: { id },
        data: { status: "PAUSED" },
      });
      await writeCrmAudit({
        playbookId: campaign.playbookId,
        action: "campaign.pause",
        entityType: "CrmCampaign",
        entityId: id,
        summary: `Кампания «${campaign.name}» на паузе`,
      });
      return json({ campaign: updated });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.crmCampaignItem.updateMany({
        where: { campaignId: id, status: "PENDING" },
        data: { status: "CANCELLED", processedAt: now, error: "Кампания остановлена" },
      });
      return tx.crmCampaign.update({
        where: { id },
        data: { status: "STOPPED", stoppedAt: now },
      });
    });
    await writeCrmAudit({
      playbookId: campaign.playbookId,
      action: "campaign.stop",
      entityType: "CrmCampaign",
      entityId: id,
      summary: `Кампания «${campaign.name}» остановлена`,
    });
    return json({ campaign: updated });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось изменить кампанию", 500);
  }
}
