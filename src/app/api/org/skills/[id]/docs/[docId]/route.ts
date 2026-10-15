import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireOrg, writeLog } from "@/lib/api";
import { orgSkillForAgent } from "@/lib/orgAccess";
import { ensureSkillDocumentTable, syncSkillDocumentAggregate } from "@/lib/skillDocs";

type Params = { params: Promise<{ id: string; docId: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  const { id, docId } = await params;
  const skill = await orgSkillForAgent(org.orgAgentId, id);
  if (!skill) return error("Навык не найден", 404);
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
    message: `Organization removed skill document ${existing.fileName}`,
    userId: org.id,
  });
  return json({ ok: true });
}
