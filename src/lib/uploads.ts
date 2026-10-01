import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/** Web video formats for hero/character assets */
const VIDEO_MIME = new Set([
  "video/webm",
  "video/mp4",
  "video/ogg",
  "video/quicktime", // sometimes browsers send this for .mov; we still prefer webm/mp4
]);

const WEB_VIDEO_MIME = new Set(["video/webm", "video/mp4", "video/ogg"]);

function extFromMime(mime: string) {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/webm":
      return "webm";
    case "video/mp4":
      return "mp4";
    case "video/ogg":
      return "ogv";
    case "video/quicktime":
      return "mov";
    default:
      return "jpg";
  }
}

export function isVideoMime(mime: string) {
  return VIDEO_MIME.has(mime) || mime.startsWith("video/");
}

export function isWebVideoMime(mime: string) {
  return WEB_VIDEO_MIME.has(mime);
}

export type AssetKind = "IMAGE" | "GIF" | "WEBP" | "VIDEO";

export function assetTypeFromMime(mime: string): AssetKind {
  if (mime === "image/gif") return "GIF";
  if (mime === "image/webp") return "WEBP";
  if (isVideoMime(mime)) return "VIDEO";
  return "IMAGE";
}

export async function saveUploadedDocument(
  file: File,
  folder: "documents" | "misc" = "documents",
) {
  const max = Number(process.env.MAX_UPLOAD_DOC_BYTES ?? 15_728_640); // 15MB
  const name = file.name || "document.docx";
  const lower = name.toLowerCase();
  const mime = file.type || "";

  const isDocx =
    lower.endsWith(".docx") ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const isDoc = lower.endsWith(".doc") || mime === "application/msword";

  if (!isDocx && !isDoc) {
    throw new Error("Нужен файл Word (.docx). Старый .doc лучше пересохранить как .docx");
  }
  if (isDoc && !isDocx) {
    throw new Error("Поддерживается .docx. Откройте файл в Word и сохраните как .docx");
  }
  if (file.size > max) {
    throw new Error(`Файл слишком большой (макс. ${Math.round(max / 1024 / 1024)} МБ)`);
  }

  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", folder);
  await mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${randomBytes(6).toString("hex")}.docx`;
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buffer);

  return {
    filename,
    originalName: name,
    mimeType:
      mime || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: file.size,
    url: `/uploads/${folder}/${filename}`,
    buffer,
    fullPath,
  };
}

export async function saveUploadedMedia(
  file: File,
  folder: "characters" | "logos" | "icons" | "misc" = "characters",
  opts?: { allowVideo?: boolean },
) {
  const allowVideo = opts?.allowVideo ?? folder === "characters";
  const imageMax = Number(process.env.MAX_UPLOAD_BYTES ?? 5_242_880);
  const videoMax = Number(process.env.MAX_UPLOAD_VIDEO_BYTES ?? 52_428_800); // 50MB

  const isVideo = isVideoMime(file.type);
  if (isVideo) {
    if (!allowVideo) {
      throw new Error("Video uploads are not allowed here");
    }
    if (!isWebVideoMime(file.type)) {
      throw new Error("Use web video formats: WebM, MP4 or Ogg");
    }
    if (file.size > videoMax) {
      throw new Error(`Video too large (max ${Math.round(videoMax / 1024 / 1024)}MB)`);
    }
  } else {
    if (!IMAGE_MIME.has(file.type)) {
      throw new Error(`Unsupported MIME type: ${file.type}`);
    }
    if (file.size > imageMax) {
      throw new Error(`File too large (max ${imageMax} bytes)`);
    }
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
    kind: assetTypeFromMime(file.type),
  };
}

/** @deprecated use saveUploadedMedia */
export async function saveUploadedImage(
  file: File,
  folder: "characters" | "logos" | "icons" | "misc" = "characters",
) {
  return saveUploadedMedia(file, folder, { allowVideo: false });
}
