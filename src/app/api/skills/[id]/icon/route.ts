import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedImage } from "@/lib/uploads";
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
    const saved = await saveUploadedImage(file, "icons");
    const updated = await prisma.skill.update({
      where: { id },
      data: { iconUrl: saved.url },
    });
    await writeLog({
      type: "skill",
      message: `Uploaded icon for ${skill.name}`,
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
