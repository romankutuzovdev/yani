import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function extFromMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

export async function saveUploadedImage(
  file: File,
  folder: "characters" | "logos" | "icons" | "misc" = "characters",
) {
  const max = Number(process.env.MAX_UPLOAD_BYTES ?? 5_242_880);
  if (file.size > max) {
    throw new Error(`File too large (max ${max} bytes)`);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new Error(`Unsupported MIME type: ${file.type}`);
  }

  const ext = extFromMime(file.type);
  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", folder);
  await mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buffer);

  return {
    filename,
    mimeType: file.type,
    sizeBytes: file.size,
    url: `/uploads/${folder}/${filename}`,
  };
}
