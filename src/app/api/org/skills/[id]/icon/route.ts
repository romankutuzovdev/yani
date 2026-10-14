import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireOrg, writeLog } from "@/lib/api";
import { orgSkillForAgent } from "@/lib/orgAccess";
import { saveUploadedImage } from "@/lib/uploads";

type Params = { params: Promise<{ id: string }> };

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
    const saved = await saveUploadedImage(file, "icons");
    const updated = await prisma.skill.update({
      where: { id },
      data: { iconUrl: saved.url },
    });
    await writeLog({
      type: "skill",
      message: `Organization uploaded icon for ${skill.name}`,
      agentId: org.orgAgentId,
      userId: org.id,
    });
    return json({ skill: { id: updated.id, iconUrl: updated.iconUrl } });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Не удалось загрузить", 400);
  }
}
