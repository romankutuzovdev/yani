import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, writeLog } from "@/lib/api";
import { crmPlaybookForAgent } from "@/lib/crm";
import {
  deleteCrmDocumentFile,
  MAX_CRM_DOCUMENTS,
  saveCrmDocument,
} from "@/lib/crmDocuments";
import { isCrmImageDoc } from "@/lib/crmMedia";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const playbook = await crmPlaybookForAgent(id, req.nextUrl.searchParams.get("agentId"));
  if (playbook instanceof Response) return playbook;

  const documents = await prisma.salesDocument.findMany({
    where: { playbookId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return json({
    documents: documents.map(({ text, ...document }) => ({
      ...document,
      isImage: isCrmImageDoc(document),
      textLength: text.length,
      textPreview: text.slice(0, 1200),
    })),
    max: MAX_CRM_DOCUMENTS,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const agentId = req.nextUrl.searchParams.get("agentId");
  const playbook = await crmPlaybookForAgent(id, agentId);
  if (playbook instanceof Response) return playbook;

  const count = await prisma.salesDocument.count({ where: { playbookId: id } });
  if (count >= MAX_CRM_DOCUMENTS) {
    return error(`Можно загрузить не больше ${MAX_CRM_DOCUMENTS} документов`);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Выберите документ");

  let saved: Awaited<ReturnType<typeof saveCrmDocument>> | null = null;
  try {
    saved = await saveCrmDocument(file);
    const last = await prisma.salesDocument.findFirst({
      where: { playbookId: id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const document = await prisma.salesDocument.create({
      data: {
        playbookId: id,
        fileName: saved.originalName.slice(0, 220),
        url: saved.url,
        mimeType: saved.mimeType,
        text: saved.text,
        sizeBytes: saved.sizeBytes,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await writeLog({
      type: "crm_document",
      message: `К навыку «${playbook.name}» добавлен документ ${document.fileName}`,
      agentId: playbook.agentId,
      meta: { playbookId: id, documentId: document.id },
    });
    return json({
      document: {
        ...document,
        text: undefined,
        isImage: isCrmImageDoc(document),
        textLength: document.text.length,
        textPreview: document.text.slice(0, 1200),
      },
    }, { status: 201 });
  } catch (cause) {
    if (saved) await deleteCrmDocumentFile(saved.url);
    return error(cause instanceof Error ? cause.message : "Не удалось обработать документ", 400);
  }
}
