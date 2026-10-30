import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  agentId: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  channel: z.enum(["EMAIL", "TELEGRAM"]),
});

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const channel = req.nextUrl.searchParams.get("channel");
  const lists = await prisma.crmContactList.findMany({
    where: {
      playbookId: id,
      ...(channel === "EMAIL" || channel === "TELEGRAM" ? { channel } : {}),
    },
    orderBy: [{ channel: "asc" }, { updatedAt: "desc" }],
    include: { _count: { select: { contacts: true } } },
  });
  return json({ lists });
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = createSchema.parse(await req.json());
    const playbook = await crmPlaybookForAgent(id, body.agentId);
    if (playbook instanceof Response) return playbook;

    const existing = await prisma.crmContactList.findFirst({
      where: { playbookId: playbook.id, name: body.name, channel: body.channel },
    });
    if (existing) return error("Список с таким именем уже есть", 409);

    const list = await prisma.crmContactList.create({
      data: {
        playbookId: playbook.id,
        name: body.name,
        channel: body.channel,
      },
      include: { _count: { select: { contacts: true } } },
    });
    return json({ list }, { status: 201 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось создать список", 500);
  }
}
