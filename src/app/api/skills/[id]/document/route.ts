import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedDocument } from "@/lib/uploads";
import { extractDocxText } from "@/lib/docx";
import { asStringArray, asJsonObject } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const skill = await prisma.skill.findUnique({ where: { id } });
  if (!skill) return error("Skill not found", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("file is required");

  try {
    const saved = await saveUploadedDocument(file, "documents");
    const documentText = await extractDocxText(saved.buffer);
    const updated = await prisma.skill.update({
      where: { id },
      data: {
        documentUrl: saved.url,
        documentName: saved.originalName,
        documentText,
      },
    });
    await writeLog({
      type: "skill",
      message: `Uploaded Word document for ${skill.name}: ${saved.originalName}`,
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

  const updated = await prisma.skill.update({
    where: { id },
    data: { documentUrl: "", documentName: "", documentText: "" },
  });

  await writeLog({
    type: "skill",
    message: `Removed Word document from ${skill.name}`,
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
