import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { asStringArray, asJsonObject } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  iconUrl: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  try {
    const body = updateSchema.parse(await req.json());
    const { config, tools, ...rest } = body;
    const skill = await prisma.skill.update({
      where: { id },
      data: {
        ...rest,
        ...(tools !== undefined ? { tools: JSON.stringify(tools) } : {}),
        ...(config !== undefined ? { config: JSON.stringify(config) } : {}),
      },
    });
    await writeLog({
      type: "skill",
      message: `Updated skill ${skill.name}`,
      userId: admin.id,
    });
    return json({
      skill: {
        ...skill,
        tools: asStringArray(skill.tools),
        config: asJsonObject(skill.config),
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  const skill = await prisma.skill.delete({ where: { id } });
  await writeLog({
    type: "skill",
    message: `Deleted skill ${skill.name}`,
    userId: admin.id,
  });
  return json({ ok: true });
}
