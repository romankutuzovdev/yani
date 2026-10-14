import { unlink } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";

type Params = { params: Promise<{ id: string; docId: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  openMode: z.enum(["preview", "direct"]).optional(),
});

async function findDoc(agentId: string, docId: string) {
  return prisma.agentDoc.findFirst({ where: { id: docId, agentId } });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, docId } = await params;
  const staff = await requireAdmin();
  if (staff instanceof Response) return staff;
  const existing = await findDoc(id, docId);
  if (!existing) return error("Документ не найден", 404);

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return error("Некорректные данные");

  const doc = await prisma.agentDoc.update({
    where: { id: docId },
    data: body.data,
    select: { id: true, title: true, fileName: true, url: true, openMode: true, sortOrder: true, createdAt: true },
  });
  await writeLog({
    type: "agent",
    message: `Updated document ${doc.title}`,
    agentId: id,
    userId: staff.id,
  });
  return json({ doc });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, docId } = await params;
  const staff = await requireAdmin();
  if (staff instanceof Response) return staff;
  const existing = await findDoc(id, docId);
  if (!existing) return error("Документ не найден", 404);

  await prisma.agentDoc.delete({ where: { id: docId } });
  if (existing.url.startsWith("/uploads/documents/")) {
    const name = path.basename(existing.url);
    await unlink(path.join(process.cwd(), "uploads", "documents", name)).catch(() => undefined);
  }
  await writeLog({
    type: "agent",
    message: `Removed document ${existing.title}`,
    agentId: id,
    userId: staff.id,
  });
  return json({ ok: true });
}
