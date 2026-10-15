import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedDocument } from "@/lib/uploads";
import { extractDocxText, extractPlainText } from "@/lib/docx";
import { asStringArray, asJsonObject } from "@/lib/utils";
import {
  MAX_SKILL_DOCS,
  ensureSkillDocumentTable,
  migrateLegacySkillDocument,
  syncSkillDocumentAggregate,
} from "@/lib/skillDocs";

type Params = { params: Promise<{ id: string }> };

/** @deprecated Prefer POST /docs — kept so older clients still attach one file. */
export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return error("Skill not found", 404);
  await ensureSkillDocumentTable();
  await migrateLegacySkillDocument(id);
  const count = await prisma.skillDocument.count({ where: { skillId: id } });
  if (count >= MAX_SKILL_DOCS) {
    return error(`Можно прикрепить не больше ${MAX_SKILL_DOCS} файлов`, 400);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("file is required");

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
    await prisma.skillDocument.create({
      data: {
        skillId: id,
        fileName: fileName.slice(0, 180),
        url,
        mimeType,
        text,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    await syncSkillDocumentAggregate(id);
    const updated = await prisma.skill.findUniqueOrThrow({ where: { id } });
    await writeLog({
      type: "skill",
      message: `Attached text for ${skill.name}: ${fileName}`,
      userId: admin.id,
    });
    return json({
      skill: {
        ...updated,
        tools: asStringArray(updated.tools),
        config: asJsonObject(updated.config),
      },
    });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Upload failed", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return error("Skill not found", 404);
  await ensureSkillDocumentTable();
  await prisma.skillDocument.deleteMany({ where: { skillId: id } });
  await syncSkillDocumentAggregate(id);

  const updated = await prisma.skill.findUniqueOrThrow({ where: { id } });
  await writeLog({
    type: "skill",
    message: `Removed attached text from ${skill.name}`,
    userId: admin.id,
  });

  return json({
    skill: {
      ...updated,
      tools: asStringArray(updated.tools),
      config: asJsonObject(updated.config),
    },
  });
}
