import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { crmLeadForAgent } from "@/lib/crm";
import { writeCrmAudit } from "@/lib/crmAudit";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  agentId: z.string().optional(),
  action: z.enum(["APPROVE", "REJECT", "EDIT"]),
  body: z.string().trim().min(1).max(30_000).optional(),
});

export async function PUT(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const input = schema.parse(await req.json());
    const outbox = await prisma.crmOutboxMessage.findUnique({
      where: { messageId: id },
      include: {
        conversation: {
          select: {
            leadId: true,
            lead: { select: { playbook: { select: { sendMode: true } } } },
          },
        },
      },
    });
    if (!outbox) return error("Исходящий черновик не найден", 404);
    const allowed = await crmLeadForAgent(outbox.conversation.leadId, input.agentId);
    if (allowed instanceof Response) return allowed;
    if (["SENT", "SENDING"].includes(outbox.status)) {
      return error("Сообщение уже отправляется или отправлено", 409);
    }

    if (input.action === "EDIT") {
      if (!input.body) return error("Введите текст сообщения");
      const updated = await prisma.$transaction(async (tx) => {
        await tx.crmMessage.update({ where: { id }, data: { body: input.body, status: "DRAFT" } });
        return tx.crmOutboxMessage.update({
          where: { messageId: id },
          data: { body: input.body, status: "DRAFT", error: "" },
        });
      });
      return json({ outbox: updated });
    }

    if (input.action === "APPROVE" && allowed.playbook.sendMode === "DRAFT_ONLY") {
      return error("В режиме «Только черновики» отправка отключена");
    }

    const status = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await prisma.$transaction(async (tx) => {
      await tx.crmMessage.update({ where: { id }, data: { status } });
      return tx.crmOutboxMessage.update({
        where: { messageId: id },
        data: {
          status,
          approvedAt: input.action === "APPROVE" ? new Date() : null,
          nextAttemptAt: new Date(),
          error: "",
        },
      });
    });
    await writeCrmAudit({
      playbookId: allowed.playbookId,
      agentId: allowed.playbook.agentId,
      action: input.action === "APPROVE" ? "outbox.approve" : "outbox.reject",
      entityType: "CrmOutboxMessage",
      entityId: updated.id,
      summary: input.action === "APPROVE" ? "Исходящее подтверждено" : "Исходящее отклонено",
      meta: { messageId: id },
    });
    return json({ outbox: updated });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось изменить черновик", 500);
  }
}
