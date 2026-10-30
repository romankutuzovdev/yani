import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmLeadForAgent } from "@/lib/crm";

type Params = { params: Promise<{ id: string }> };

/** Clear all dialog history for a lead (messages, outbox, conversations). Keeps the card. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const lead = await crmLeadForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (lead instanceof Response) return lead;

  const conversations = await prisma.crmConversation.findMany({
    where: { leadId: id },
    select: { id: true },
  });
  const conversationIds = conversations.map((row) => row.id);
  if (!conversationIds.length) {
    return json({ ok: true, cleared: 0 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.crmOutboxMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await tx.crmMessage.deleteMany({
      where: { conversationId: { in: conversationIds } },
    });
    await tx.crmConversation.deleteMany({
      where: { leadId: id },
    });
  });

  await writeLog({
    type: "crm_lead",
    message: `Очищен диалог карточки ${lead.displayName || lead.email || lead.id}`,
    agentId: lead.playbook.agentId,
    meta: { playbookId: lead.playbookId, leadId: id, conversations: conversationIds.length },
  });

  return json({ ok: true, cleared: conversationIds.length });
}
