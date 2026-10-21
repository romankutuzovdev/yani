import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { CRM_STAGES, crmLeadForAgent, leadIdentities } from "@/lib/crm";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  agentId: z.string().optional(),
  displayName: z.string().trim().max(160).optional(),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(80).optional(),
  telegram: z.string().trim().max(120).optional(),
  stage: z.enum(CRM_STAGES).optional(),
  notes: z.string().trim().max(10_000).optional(),
  agentInstruction: z.string().trim().max(10_000).optional(),
  agentPaused: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const allowed = await crmLeadForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (allowed instanceof Response) return allowed;

  const lead = await prisma.salesLead.findUnique({
    where: { id },
    include: {
      playbook: true,
      identities: true,
      conversations: {
        orderBy: { createdAt: "asc" },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            take: 300,
            include: { outbox: true },
          },
        },
      },
      fieldChanges: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  return json({ lead });
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    const allowed = await crmLeadForAgent(id, body.agentId);
    if (allowed instanceof Response) return allowed;

    const contacts = {
      email: body.email ?? allowed.email,
      phone: body.phone ?? allowed.phone,
      telegram: body.telegram ?? allowed.telegram,
    };
    const identities = leadIdentities(contacts);
    if (identities.length) {
      const duplicate = await prisma.leadIdentity.findFirst({
        where: {
          playbookId: allowed.playbookId,
          leadId: { not: id },
          OR: identities.map((identity) => ({
            type: identity.type,
            value: identity.value,
          })),
        },
        select: { leadId: true, type: true },
      });
      if (duplicate) {
        return error("Контакт уже есть в другой карточке этого навыка", 409, {
          existingLeadId: duplicate.leadId,
          duplicateType: duplicate.type,
        });
      }
    }

    const lead = await prisma.$transaction(async (tx) => {
      const updated = await tx.salesLead.update({
        where: { id },
        data: {
          displayName: body.displayName,
          company: body.company,
          email: body.email,
          phone: body.phone,
          telegram: body.telegram,
          stage: body.stage,
          notes: body.notes,
          agentInstruction: body.agentInstruction,
          agentPaused: body.agentPaused,
        },
      });
      await tx.leadIdentity.deleteMany({ where: { leadId: id } });
      if (identities.length) {
        await tx.leadIdentity.createMany({
          data: identities.map((identity) => ({
            playbookId: allowed.playbookId,
            leadId: id,
            ...identity,
          })),
        });
      }
      return updated;
    });

    return json({ lead });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Проверьте поля");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return error("Контакт уже есть в другой карточке этого навыка", 409);
    }
    return error("Не удалось сохранить карточку", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const lead = await crmLeadForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (lead instanceof Response) return lead;
  await prisma.salesLead.delete({ where: { id } });
  await writeLog({
    type: "crm_lead",
    message: `Удалена CRM-карточка ${lead.displayName || lead.email || lead.id}`,
    agentId: lead.playbook.agentId,
    meta: { playbookId: lead.playbookId, leadId: id },
  });
  return json({ ok: true });
}
