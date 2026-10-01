import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedImage } from "@/lib/uploads";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return error("Agent not found", 404);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return error("file is required");

  try {
    const saved = await saveUploadedImage(file, "logos");
    const updated = await prisma.agent.update({
      where: { id },
      data: { logoUrl: saved.url },
    });
    await writeLog({
      type: "agent",
      message: `Uploaded logo for ${agent.name}`,
      agentId: id,
      userId: admin.id,
    });
    return json({ logoUrl: updated.logoUrl });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Upload failed", 400);
  }
}
