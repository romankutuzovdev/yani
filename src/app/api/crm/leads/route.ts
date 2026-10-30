import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { CRM_STAGES, crmPlaybookForAgent, leadIdentities } from "@/lib/crm";
import { listPlaybookLeads } from "@/lib/crmLeadsList";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  agentId: z.string().optional(),
  playbookId: z.string().min(1),
  displayName: z.string().trim().max(160).optional(),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(80).optional(),
  telegram: z.string().trim().max(120).optional(),
  stage: z.enum(CRM_STAGES).optional(),
  notes: z.string().trim().max(10_000).optional(),
  agentInstruction: z.string().trim().max(10_000).optional(),
});

export async function GET(req: NextRequest) {
  const playbookId = req.nextUrl.searchParams.get("playbookId")?.trim();
  if (!playbookId) return error("Не указан навык продажи");
  const playbook = await crmPlaybookForAgent(
    playbookId,
    req.nextUrl.searchParams.get("agentId"),
  );
  if (playbook instanceof Response) return playbook;

  const leads = await listPlaybookLeads(playbookId);

  return json({
    playbook: {
      id: playbook.id,
      name: playbook.name,
      status: playbook.status,
      sendMode: playbook.sendMode,
      channelTelegramEnabled: playbook.channelTelegramEnabled,
      channelEmailEnabled: playbook.channelEmailEnabled,
      replyCount: playbook.replyCount,
      replySpendUsd: playbook.replySpendUsd,
    },
    stages: CRM_STAGES,
    leads,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = createSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(body.playbookId, body.agentId);
    if (playbook instanceof Response) return playbook;

    const identities = leadIdentities(body);
    if (identities.length) {
      const duplicate = await prisma.leadIdentity.findFirst({
        where: {
          playbookId: playbook.id,
          OR: identities.map((identity) => ({
            type: identity.type,
            value: identity.value,
          })),
        },
        select: { leadId: true, type: true },
      });
      if (duplicate) {
        return error("Контакт уже есть в этом навыке продажи", 409, {
          existingLeadId: duplicate.leadId,
          duplicateType: duplicate.type,
        });
      }
    }

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.salesLead.create({
        data: {
          playbookId: playbook.id,
          displayName: body.displayName ?? "",
          company: body.company ?? "",
          email: body.email ?? "",
          phone: body.phone ?? "",
          telegram: body.telegram ?? "",
          stage: body.stage ?? "NEW",
          notes: body.notes ?? "",
          agentInstruction: body.agentInstruction ?? "",
        },
      });
      if (identities.length) {
        await tx.leadIdentity.createMany({
          data: identities.map((identity) => ({
            playbookId: playbook.id,
            leadId: created.id,
            ...identity,
          })),
        });
      }
      return created;
    });

    await writeLog({
      type: "crm_lead",
      message: `Создана карточка ${lead.displayName || lead.email || lead.phone || lead.id}`,
      agentId: playbook.agentId,
      meta: { playbookId: playbook.id, leadId: lead.id },
    });
    return json({ lead }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Проверьте поля");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return error("Контакт уже есть в этом навыке продажи", 409);
    }
    return error("Не удалось создать карточку", 500);
  }
}
