import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import type { Prisma } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;
  try {
    const body = updateSchema.parse(await req.json());
    const { config, ...rest } = body;
    const skill = await prisma.skill.update({
      where: { id },
      data: {
        ...rest,
        ...(config !== undefined ? { config: config as Prisma.InputJsonValue } : {}),
      },
    });
    await writeLog({
      type: "skill",
      message: `Updated skill ${skill.name}`,
      userId: admin.id,
    });
    return json({ skill });
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
