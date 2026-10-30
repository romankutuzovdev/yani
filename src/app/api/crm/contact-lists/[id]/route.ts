import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { resolveCrmAgentId } from "@/lib/crm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

async function listForAgent(listId: string, requestedAgentId?: string | null) {
  const agentId = await resolveCrmAgentId(requestedAgentId);
  if (agentId instanceof Response) return agentId;
  const list = await prisma.crmContactList.findFirst({
    where: { id: listId, playbook: { agentId } },
    include: {
      _count: { select: { contacts: true } },
      playbook: { select: { id: true, agentId: true } },
    },
  });
  if (!list) return error("Список не найден", 404);
  return list;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const list = await listForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (list instanceof Response) return list;
  const contacts = await prisma.crmContactListItem.findMany({
    where: { listId: id },
    orderBy: { createdAt: "desc" },
    take: 5_000,
  });
  return json({ list, contacts });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const list = await listForAgent(id, body.agentId);
    if (list instanceof Response) return list;

    if (body.name && body.name !== list.name) {
      const clash = await prisma.crmContactList.findFirst({
        where: {
          playbookId: list.playbookId,
          channel: list.channel,
          name: body.name,
          id: { not: id },
        },
      });
      if (clash) return error("Список с таким именем уже есть", 409);
    }

    const updated = await prisma.crmContactList.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
      },
      include: { _count: { select: { contacts: true } } },
    });
    return json({ list: updated });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось сохранить список", 500);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const list = await listForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (list instanceof Response) return list;
  await prisma.crmContactList.delete({ where: { id } });
  return json({ ok: true });
}
