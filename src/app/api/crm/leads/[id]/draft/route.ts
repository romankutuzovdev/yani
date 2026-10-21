import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmLeadForAgent } from "@/lib/crm";
import { generateGroundedSalesDraft } from "@/lib/crmGrounding";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  agentId: z.string().optional(),
  kind: z.enum(["ANSWER", "PROPOSAL"]),
  prompt: z.string().trim().max(10_000).default(""),
});

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = schema.parse(await req.json());
    if (body.kind === "ANSWER" && !body.prompt) return error("Введите вопрос клиента");
    const allowed = await crmLeadForAgent(id, body.agentId);
    if (allowed instanceof Response) return allowed;

    const lead = await prisma.salesLead.findUnique({
      where: { id },
      include: {
        playbook: {
          include: {
            documents: { where: { status: "READY" }, orderBy: { sortOrder: "asc" } },
            agent: { select: { model: true } },
          },
        },
        conversations: {
          orderBy: { lastMessageAt: "asc" },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
        },
      },
    });
    if (!lead) return error("Карточка не найдена", 404);
    if (!lead.playbook.documents.length) {
      return error("Сначала загрузите документы в навык продажи");
    }

    const result = await generateGroundedSalesDraft({
      kind: body.kind,
      prompt: body.prompt,
      playbook: lead.playbook,
      lead,
      documents: lead.playbook.documents,
      history: lead.conversations.flatMap((conversation) => conversation.messages),
      model: lead.playbook.agent.model,
    });
    await writeLog({
      type: "crm_draft",
      message: body.kind === "PROPOSAL" ? "Подготовлен черновик КП" : "Подготовлен ответ по материалам",
      agentId: lead.playbook.agentId,
      meta: { leadId: id, playbookId: lead.playbookId, sourceIds: result.sources.map((source) => source.id) },
    });
    return json(result);
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error(cause instanceof Error ? cause.message : "Не удалось подготовить черновик", 500);
  }
}
