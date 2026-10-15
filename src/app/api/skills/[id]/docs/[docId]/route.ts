import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { ensureSkillDocumentTable, syncSkillDocumentAggregate } from "@/lib/skillDocs";

type Params = { params: Promise<{ id: string; docId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id, docId } = await params;
  await ensureSkillDocumentTable();
  const existing = await prisma.skillDocument.findFirst({
    where: { id: docId, skillId: id },
    select: { id: true, fileName: true },
  });
  if (!existing) return error("Документ не найден", 404);
  await prisma.skillDocument.delete({ where: { id: docId } });
  await syncSkillDocumentAggregate(id);
  await writeLog({
    type: "skill",
    message: `Removed skill document ${existing.fileName}`,
    userId: admin.id,
  });
  return json({ ok: true });
}
