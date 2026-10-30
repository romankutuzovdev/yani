import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json } from "@/lib/api";
import { resolveCrmAgentId } from "@/lib/crm";
import {
  normalizeContactForChannel,
  type ContactListChannel,
} from "@/lib/crmContactLists";
import { buildImportPreview, parseImportFile } from "@/lib/crmImport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const contactSchema = z.object({
  displayName: z.string().optional(),
  company: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  telegram: z.string().optional(),
  notes: z.string().optional(),
});

const addSchema = z.object({
  agentId: z.string().optional(),
  contacts: z.array(contactSchema).min(1).max(5_000),
});

const deleteSchema = z.object({
  agentId: z.string().optional(),
  contactIds: z.array(z.string().min(1)).min(1).max(5_000),
});

async function listForAgent(listId: string, requestedAgentId?: string | null) {
  const agentId = await resolveCrmAgentId(requestedAgentId);
  if (agentId instanceof Response) return agentId;
  const list = await prisma.crmContactList.findFirst({
    where: { id: listId, playbook: { agentId } },
  });
  if (!list) return error("Список не найден", 404);
  return list;
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const agentId = String(form.get("agentId") ?? "").trim() || undefined;
      const list = await listForAgent(id, agentId);
      if (list instanceof Response) return list;
      const file = form.get("file");
      if (!(file instanceof File)) return error("Прикрепите CSV или XLSX");
      const buffer = Buffer.from(await file.arrayBuffer());
      if (!buffer.length) return error("Файл пустой");
      if (buffer.length > 5 * 1024 * 1024) return error("Файл больше 5 МБ");
      const parsed = parseImportFile(buffer, file.name || "import.csv");
      const preview = buildImportPreview(parsed, []);
      const channel = list.channel as ContactListChannel;
      const okRows = preview.filter((row) => row.status === "OK");
      let created = 0;
      let skipped = 0;
      for (const row of okRows) {
        const normalized = normalizeContactForChannel(channel, row);
        if (!normalized.ok) {
          skipped += 1;
          continue;
        }
        const key =
          channel === "EMAIL" ? normalized.contact.email : normalized.contact.telegram;
        const dup = await prisma.crmContactListItem.findFirst({
          where:
            channel === "EMAIL"
              ? { listId: id, email: key }
              : { listId: id, telegram: key },
        });
        if (dup) {
          skipped += 1;
          continue;
        }
        await prisma.crmContactListItem.create({
          data: { listId: id, ...normalized.contact },
        });
        created += 1;
      }
      await prisma.crmContactList.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      return json({ created, skipped, total: okRows.length });
    }

    const body = addSchema.parse(await req.json());
    const list = await listForAgent(id, body.agentId);
    if (list instanceof Response) return list;
    const channel = list.channel as ContactListChannel;

    let created = 0;
    let skipped = 0;
    const createdContacts = [];
    for (const raw of body.contacts) {
      const normalized = normalizeContactForChannel(channel, raw);
      if (!normalized.ok) {
        skipped += 1;
        continue;
      }
      const key =
        channel === "EMAIL" ? normalized.contact.email : normalized.contact.telegram;
      const dup = await prisma.crmContactListItem.findFirst({
        where:
          channel === "EMAIL"
            ? { listId: id, email: key }
            : { listId: id, telegram: key },
      });
      if (dup) {
        skipped += 1;
        continue;
      }
      const contact = await prisma.crmContactListItem.create({
        data: { listId: id, ...normalized.contact },
      });
      createdContacts.push(contact);
      created += 1;
    }
    await prisma.crmContactList.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    return json({ created, skipped, contacts: createdContacts }, { status: 201 });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error(cause instanceof Error ? cause.message : "Не удалось добавить контакты", 500);
  }
}

/** Delete one or many contacts from the list. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = deleteSchema.parse(await req.json());
    const list = await listForAgent(id, body.agentId);
    if (list instanceof Response) return list;

    const result = await prisma.crmContactListItem.deleteMany({
      where: { listId: id, id: { in: body.contactIds } },
    });
    await prisma.crmContactList.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    return json({ deleted: result.count });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Проверьте запрос");
    return error("Не удалось удалить контакты", 500);
  }
}
