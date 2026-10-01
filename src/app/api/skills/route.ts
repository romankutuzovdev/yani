import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { asJsonObject, asStringArray } from "@/lib/utils";

const skillSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
  return json({
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
    const skill = await prisma.skill.create({
      data: {
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt ?? "",
        tools: JSON.stringify(body.tools ?? []),
        enabled: body.enabled ?? true,
        config: JSON.stringify(body.config ?? {}),
      },
    });
    await writeLog({
      type: "skill",
      message: `Created skill ${skill.name}`,
      userId: admin.id,
    });
    return json({ skill }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return error(e.issues[0]?.message ?? "Invalid input");
    return error(e instanceof Error ? e.message : "Failed", 500);
  }
}
