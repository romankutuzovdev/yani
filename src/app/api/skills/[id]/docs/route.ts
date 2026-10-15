import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedDocument } from "@/lib/uploads";
import { extractDocxText, extractPlainText } from "@/lib/docx";
import {
  MAX_SKILL_DOCS,
  ensureSkillDocumentTable,
  migrateLegacySkillDocument,
  syncSkillDocumentAggregate,
} from "@/lib/skillDocs";

type Params = { params: Promise<{ id: string }> };

const docView = {
  id: true,
  fileName: true,
  url: true,
  mimeType: true,
  sortOrder: true,
  createdAt: true,
} as const;

export async function GET(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  await ensureSkillDocumentTable();
  const skill = await prisma.skill.findUnique({ where: { id }, select: { id: true } });
  if (!skill) return error("Навык не найден", 404);
  await migrateLegacySkillDocument(id);
  try {
  const docs = await prisma.skillDocument.findMany({
    where: { skillId: id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: docView,
  });
  return json({ docs, max: MAX_SKILL_DOCS });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось прочитать документы", 500);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  await ensureSkillDocumentTable();
  const skill = await prisma.skill.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!skill) return error("Навык не найден", 404);
  await migrateLegacySkillDocument(id);

  const count = await prisma.skillDocument.count({ where: { skillId: id } });
  if (count >= MAX_SKILL_DOCS) {
    return error(`Можно прикрепить не больше ${MAX_SKILL_DOCS} файлов`, 400);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Нужен файл");

  try {
    const lower = (file.name || "").toLowerCase();
    const isPlain =
      lower.endsWith(".txt") || lower.endsWith(".md") || file.type.startsWith("text/");
    let url = "";
    let fileName = file.name || "Текст";
    let mimeType = file.type || "text/plain";
    let text = "";
    if (isPlain) {
      text = extractPlainText(Buffer.from(await file.arrayBuffer()));
    } else {
      const saved = await saveUploadedDocument(file, "documents");
      text = await extractDocxText(saved.buffer);
      url = saved.url;
      fileName = saved.originalName;
      mimeType = saved.mimeType;
    }
    const last = await prisma.skillDocument.findFirst({
      where: { skillId: id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const doc = await prisma.skillDocument.create({
      data: {
        skillId: id,
        fileName: fileName.slice(0, 180),
        url,
        mimeType,
        text,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: docView,
    });
    await syncSkillDocumentAggregate(id);
    await writeLog({
      type: "skill",
      message: `Attached ${doc.fileName} to ${skill.name}`,
      userId: admin.id,
    });
    return json({ doc });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить", 400);
  }
}
