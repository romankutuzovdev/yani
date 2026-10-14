import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireOrg, writeLog } from "@/lib/api";
import { orgSkillForAgent } from "@/lib/orgAccess";
import { saveUploadedDocument } from "@/lib/uploads";
import { extractDocxText, extractPlainText } from "@/lib/docx";

type Params = { params: Promise<{ id: string }> };

const skillView = { id: true, name: true, documentName: true } as const;

export async function POST(req: NextRequest, { params }: Params) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  const { id } = await params;

  const skill = await orgSkillForAgent(org.orgAgentId, id);
  if (!skill) return error("Навык не найден", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("Нужен файл");

  try {
    const lower = (file.name || "").toLowerCase();
    const isPlain = lower.endsWith(".txt") || lower.endsWith(".md") || file.type.startsWith("text/");
    let documentUrl = "";
    let documentName = file.name || "Текст";
    let documentText = "";
    if (isPlain) {
      documentText = extractPlainText(Buffer.from(await file.arrayBuffer()));
    } else {
      const saved = await saveUploadedDocument(file, "documents");
      documentText = await extractDocxText(saved.buffer);
      documentUrl = saved.url;
      documentName = saved.originalName;
    }
    const updated = await prisma.skill.update({
      where: { id },
      data: { documentUrl, documentName, documentText },
      select: skillView,
    });
    await writeLog({
      type: "skill",
      message: `Organization attached ${documentName} to ${skill.name}`,
      agentId: org.orgAgentId,
      userId: org.id,
    });
    return json({ skill: updated });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить", 400);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  const { id } = await params;

  const skill = await orgSkillForAgent(org.orgAgentId, id);
  if (!skill) return error("Навык не найден", 404);

  const updated = await prisma.skill.update({
    where: { id },
    data: { documentUrl: "", documentName: "", documentText: "" },
    select: skillView,
  });
  await writeLog({
    type: "skill",
    message: `Organization removed document from ${skill.name}`,
    agentId: org.orgAgentId,
    userId: org.id,
  });
  return json({ skill: updated });
}
