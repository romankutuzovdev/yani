import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { error, json, requireAdmin, writeLog } from "@/lib/api";
import { saveUploadedImage } from "@/lib/uploads";
import type { CharacterState } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

const STATES = new Set([
  "IDLE",
  "THINKING",
  "WORKING",
  "SUCCESS",
  "ERROR",
  "SPEAKING",
  "WAITING",
  "SAD",
  "ANGRY",
]);

export async function POST(req: NextRequest, { params }: Params) {
  const admin = await requireAdmin();
  if (admin instanceof Response) return admin;
  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { character: true },
  });
  if (!agent?.characterId || !agent.character) return error("Agent/character not found", 404);

  const form = await req.formData();
  const state = String(form.get("state") ?? "").toUpperCase();
  const file = form.get("file");

  if (!STATES.has(state)) return error("Invalid character state");
  if (!(file instanceof File)) return error("file is required");

  try {
    const saved = await saveUploadedImage(file);
    const assetType =
      saved.mimeType === "image/gif"
        ? "GIF"
        : saved.mimeType === "image/webp"
          ? "WEBP"
          : "IMAGE";

    const asset = await prisma.characterAsset.upsert({
      where: {
        characterId_state: {
          characterId: agent.characterId,
          state: state as CharacterState,
        },
      },
      update: {
        url: saved.url,
        mimeType: saved.mimeType,
        filename: saved.filename,
        sizeBytes: saved.sizeBytes,
        type: assetType,
      },
      create: {
        characterId: agent.characterId,
        state: state as CharacterState,
        url: saved.url,
        mimeType: saved.mimeType,
        filename: saved.filename,
        sizeBytes: saved.sizeBytes,
        type: assetType,
      },
    });

    await writeLog({
      type: "character",
      message: `Uploaded ${state} asset for ${agent.name}`,
      agentId: agent.id,
      userId: admin.id,
    });

    return json({ asset });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Upload failed", 400);
  }
}
