import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import { deleteCrmDocumentFile } from "@/lib/crmDocuments";

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id, documentId } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const document = await prisma.salesDocument.findFirst({
    where: { id: documentId, playbookId: id },
  });
  if (!document) return error("Документ не найден", 404);
  return json({ document });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id, documentId } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;
  const document = await prisma.salesDocument.findFirst({
    where: { id: documentId, playbookId: id },
  });
  if (!document) return error("Документ не найден", 404);

  await prisma.salesDocument.delete({ where: { id: documentId } });
  await deleteCrmDocumentFile(document.url);
  await writeLog({
    type: "crm_document",
    message: `Из навыка «${playbook.name}» удалён документ ${document.fileName}`,
    agentId: playbook.agentId,
    meta: { playbookId: id, documentId },
  });
  return json({ ok: true });
}
