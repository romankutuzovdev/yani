import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  product: z.string().trim().max(4000).optional(),
  systemPrompt: z.string().trim().max(20_000).optional(),
  goals: z.string().trim().max(4000).optional(),
  communicationStyle: z.string().trim().max(4000).optional(),
  restrictions: z.string().trim().max(4000).optional(),
  qualificationQuestions: z.string().trim().max(8000).optional(),
  status: z.enum(["RUNNING", "STOPPED"]).optional(),
  sendMode: z.enum(["DRAFT_ONLY", "APPROVAL_REQUIRED", "AUTO"]).optional(),
});

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  return json({ playbook });
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = updateSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;

    const updated = await prisma.salesPlaybook.update({
      where: { id },
      data: {
        name: body.name,
        product: body.product,
        systemPrompt: body.systemPrompt,
        goals: body.goals,
        communicationStyle: body.communicationStyle,
        restrictions: body.restrictions,
        qualificationQuestions: body.qualificationQuestions,
        status: body.status,
        sendMode: body.sendMode,
      },
    });
    await writeLog({
      type: "crm_playbook",
      message:
        body.status === "RUNNING"
          ? `Запущен навык продажи «${updated.name}»`
          : body.status === "STOPPED"
            ? `Остановлен навык продажи «${updated.name}»`
            : `Обновлён навык продажи «${updated.name}»`,
      agentId: updated.agentId,
    });
    return json({ playbook: updated });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Проверьте поля");
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return error("Навык с таким названием уже есть у этого агента", 409);
    }
    return error("Не удалось сохранить навык продажи", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  await prisma.salesPlaybook.delete({ where: { id } });
  await writeLog({
    type: "crm_playbook",
    message: `Удалён навык продажи «${playbook.name}»`,
    agentId: playbook.agentId,
  });
  return json({ ok: true });
}
