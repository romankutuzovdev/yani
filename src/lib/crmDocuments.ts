import { randomBytes } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { extractDocxText } from "@/lib/docx";
import { isCrmImageMime } from "@/lib/crmMedia";

export const MAX_CRM_DOCUMENTS = 20;

const MIME_BY_EXTENSION: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function clampCrmDocumentText(raw: string) {
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const max = Number(process.env.MAX_CRM_DOCUMENT_CHARS ?? 120_000);
  if (!text) throw new Error("В документе не найден текст");
  return text.length > max
    ? `${text.slice(0, max)}\n\n[…текст обрезан, всего ${text.length} символов]`
    : text;
}

async function extractPptxText(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const aNumber = Number(a.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const bNumber = Number(b.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return aNumber - bNumber;
    });

  const pages: string[] = [];
  for (let index = 0; index < slides.length; index += 1) {
    const xml = await zip.file(slides[index]!)?.async("text");
    if (!xml) continue;
    const fragments = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1] ?? "").trim())
      .filter(Boolean);
    if (fragments.length) pages.push(`Слайд ${index + 1}\n${fragments.join("\n")}`);
  }
  return clampCrmDocumentText(pages.join("\n\n"));
}

export async function extractCrmDocumentText(extension: string, buffer: Buffer) {
  if (extension === "docx") return clampCrmDocumentText(await extractDocxText(buffer));
  if (extension === "pdf") {
    const result = await pdf(buffer);
    return clampCrmDocumentText(result.text ?? "");
  }
  if (extension === "pptx") return extractPptxText(buffer);
  throw new Error("Поддерживаются только DOCX, PDF, PPTX и изображения");
}

function imageCatalogText(originalName: string, url: string, mimeType: string) {
  return [
    `[IMAGE] ${originalName}`,
    `mime: ${mimeType}`,
    `url: ${url}`,
    "Картинка-вложение: отправляется клиенту файлом, если в промпте/ответе указано это имя или маркер [[IMAGE:имя]] / [[FILE:имя]]. Не является текстом для обучения.",
  ].join("\n");
}

export async function saveCrmDocument(file: File) {
  const max = Number(process.env.MAX_UPLOAD_DOC_BYTES ?? 83_886_080); // 80MB
  if (file.size > max) {
    throw new Error(`Файл больше ${Math.round(max / 1024 / 1024)} МБ`);
  }

  const originalName = (file.name || "document").split(/[/\\]/).pop() || "document";
  const extension = originalName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (!(extension in MIME_BY_EXTENSION)) {
    throw new Error("Поддерживаются DOCX, PDF, PPTX и картинки PNG/JPG/WEBP/GIF");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = MIME_BY_EXTENSION[extension]!;
  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "crm-documents");
  await mkdir(dir, { recursive: true });
  const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
  const fullPath = path.join(dir, fileName);
  await writeFile(fullPath, buffer);
  const url = `/uploads/crm-documents/${fileName}`;

  const text = isCrmImageMime(mimeType)
    ? imageCatalogText(originalName, url, mimeType)
    : await extractCrmDocumentText(extension, buffer);

  return {
    originalName,
    mimeType,
    sizeBytes: file.size,
    text,
    url,
    fullPath,
  };
}

export async function deleteCrmDocumentFile(url: string) {
  const prefix = "/uploads/crm-documents/";
  if (!url.startsWith(prefix)) return;
  const fileName = path.basename(url.slice(prefix.length));
  const fullPath = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "crm-documents", fileName);
  await unlink(fullPath).catch(() => undefined);
}
