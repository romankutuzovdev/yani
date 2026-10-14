import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { clampSkillText } from "@/lib/docx";
import { asJsonObject, asStringArray } from "@/lib/utils";
import { clampPage, readListQuery, wordsWhere } from "@/lib/paging";

const skillSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  documentText: z.string().optional(),
  model: z.string().optional(),
  iconUrl: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const brief = req.nextUrl.searchParams.get("brief") === "1";
  const { page, q } = readListQuery(req.nextUrl);
  const where = wordsWhere(["name", "description"], q);
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
        model: true,
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
  return json({
    ...meta,
    skills: skills.map((s) => ({
      ...s,
      tools: asStringArray(s.tools),
      config: asJsonObject(s.config),
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  try {
    const body = skillSchema.parse(await req.json());
    const maxSort = await prisma.skill.aggregate({ _max: { sortOrder: true } });
    const documentText = body.documentText?.trim() ? clampSkillText(body.documentText) : "";
    const skill = await prisma.skill.create({
      data: {
        name: body.name,
        description: body.description?.trim() || body.name.trim(),
        systemPrompt: body.systemPrompt ?? "",
        documentText,
        documentName: documentText ? "Вставленный текст" : "",
        model: body.model ?? "",
        iconUrl: body.iconUrl ?? "",
        tools: JSON.stringify(body.tools ?? []),
        enabled: body.enabled ?? true,
        sortOrder: body.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1,
        config: JSON.stringify(body.config ?? {}),
      },
    });
    await writeLog({
      type: "skill",
      message: `Created skill ${skill.name}`,
      userId: admin.id,
    });
    return json(
      {
        skill: {
          ...skill,
          tools: asStringArray(skill.tools),
          config: asJsonObject(skill.config),
        },
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed", 500);
  }
}
