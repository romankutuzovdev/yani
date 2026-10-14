import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireOrg, writeLog } from "@/lib/api";
import { clampSkillText } from "@/lib/docx";
import { clampPage, readListQuery, wordsWhere } from "@/lib/paging";
import { asJsonObject, asStringArray } from "@/lib/utils";

const skillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  documentText: z.string().optional(),
  iconUrl: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

function present<T extends { model: string; tools: string; config: string }>(skill: T) {
  return {
    ...skill,
    model: "",
    tools: asStringArray(skill.tools),
    config: asJsonObject(skill.config),
  };
}

export async function GET(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;

  const brief = req.nextUrl.searchParams.get("brief") === "1";
  const { page, q } = readListQuery(req.nextUrl);
  const linked = await prisma.agentSkill.findMany({
    where: { agentId: org.orgAgentId },
    select: { skillId: true },
  });
  const where = {
    id: { in: linked.map((row) => row.skillId) },
    ...wordsWhere(["name", "description"], q),
  };
  const orderBy = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

  if (brief) {
    const skills = await prisma.skill.findMany({
      where,
      orderBy,
      select: {
        id: true,
        name: true,
        description: true,
        iconUrl: true,
        enabled: true,
        documentName: true,
      },
    });
    return json({ skills });
  }

  const total = await prisma.skill.count({ where });
  const meta = clampPage(page, total);
  const skills = await prisma.skill.findMany({
    where,
    orderBy,
    skip: (meta.page - 1) * meta.pageSize,
    take: meta.pageSize,
  });
  return json({ ...meta, skills: skills.map(present) });
}

export async function POST(req: NextRequest) {
  const org = await requireOrg();
  if (org instanceof Response) return org;
  try {
    const body = skillSchema.parse(await req.json());
    const maxSort = await prisma.skill.aggregate({ _max: { sortOrder: true } });
    const documentText = body.documentText?.trim() ? clampSkillText(body.documentText) : "";
    const sortOrder = (maxSort._max.sortOrder ?? 0) + 1;
    const skill = await prisma.skill.create({
      data: {
        name: body.name,
        description: body.description?.trim() || body.name,
        systemPrompt: body.systemPrompt ?? "",
        documentText,
        documentName: documentText ? "Вставленный текст" : "",
        model: "",
        iconUrl: body.iconUrl ?? "",
        tools: JSON.stringify(body.tools ?? []),
        enabled: body.enabled ?? true,
        sortOrder,
        config: "{}",
      },
    });
    await prisma.agentSkill.create({
      data: {
        agentId: org.orgAgentId,
        skillId: skill.id,
        enabled: true,
        visible: true,
        sortOrder,
      },
    });
    await writeLog({
      type: "skill",
      message: `Organization created skill ${skill.name}`,
      agentId: org.orgAgentId,
      userId: org.id,
    });
    return json({ skill: present(skill) }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Укажите название навыка");
    if (typeof e === "object" && e && "code" in e && e.code === "P2002") {
      return error("Навык с таким названием уже есть");
    }
    return error(e instanceof Error ? e.message : "Не удалось создать", 500);
  }
}
