import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireOrg, writeLog } from "@/lib/api";
import { orgSkillForAgent } from "@/lib/orgAccess";
import { clampSkillText } from "@/lib/docx";
import { asJsonObject, asStringArray } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1, "Нужно название").max(120).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  documentText: z.string().optional(),
  documentName: z.string().optional(),
  iconUrl: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  const { id } = await params;

  const skill = await orgSkillForAgent(org.orgAgentId, id);
  if (!skill) return error("Навык не найден", 404);

  try {
    const body = schema.parse(await req.json());
    const { tools, documentText, documentName, ...rest } = body;
    const textPatch: { documentText?: string; documentName?: string; documentUrl?: string } = {};
    if (documentText !== undefined) {
      const clamped = documentText.trim() ? clampSkillText(documentText) : "";
      textPatch.documentText = clamped;
      if (!clamped) {
        textPatch.documentName = "";
        textPatch.documentUrl = "";
      } else if (documentName !== undefined) {
        textPatch.documentName = documentName.trim() || "Вставленный текст";
      }
    } else if (documentName !== undefined) {
      textPatch.documentName = documentName;
    }
    const updated = await prisma.skill.update({
      where: { id },
      data: {
        ...rest,
        ...textPatch,
        ...(tools !== undefined ? { tools: JSON.stringify(tools) } : {}),
      },
    });
    await writeLog({
      type: "skill",
      message: `Organization updated skill ${updated.name}`,
      agentId: org.orgAgentId,
      userId: org.id,
    });
    return json({
      skill: {
        ...updated,
        model: "",
        tools: asStringArray(updated.tools),
        config: asJsonObject(updated.config),
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Некорректные данные");
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      return error("Навык с таким названием уже есть");
    }
    return error(e instanceof Error ? e.message : "Не удалось сохранить", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  const { id } = await params;
  const skill = await orgSkillForAgent(org.orgAgentId, id);
  if (!skill) return error("Навык не найден", 404);

  await prisma.agentSkill.delete({
    where: { agentId_skillId: { agentId: org.orgAgentId, skillId: id } },
  });
  const others = await prisma.agentSkill.count({ where: { skillId: id } });
  if (others === 0) {
    await prisma.skill.delete({ where: { id } });
  }
  await writeLog({
    type: "skill",
    message: `Organization removed skill ${skill.name}`,
    agentId: org.orgAgentId,
    userId: org.id,
  });
  return json({ ok: true });
}
