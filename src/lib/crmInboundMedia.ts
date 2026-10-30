import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { extractCrmDocumentText } from "@/lib/crmDocuments";
import { isCrmImageMime, type CrmAttachment } from "@/lib/crmMedia";

const TEXT_EXTS = new Set(["docx", "pdf", "pptx", "txt", "md"]);

export function playbookWantsInboundDocAnalysis(playbook: {
  systemPrompt?: string | null;
  goals?: string | null;
  product?: string | null;
  restrictions?: string | null;
  qualificationQuestions?: string | null;
}) {
  const blob = [
    playbook.systemPrompt,
    playbook.goals,
    playbook.product,
    playbook.restrictions,
    playbook.qualificationQuestions,
  ]
    .filter(Boolean)
    .join("\n");
  if (!blob.trim()) return false;
  return (
    /(анализ|разбер|читай|прочит|учитывай|обрабатывай|изучай).{0,60}(документ|файл|вложен|pdf|docx|pptx|презентац)/i.test(
      blob,
    ) ||
    /(документ|файл|вложен|pdf|docx|pptx|презентац).{0,60}(анализ|разбер|читай|прочит|учитывай|обрабатывай)/i.test(
      blob,
    ) ||
    /(analyze|review|read|parse).{0,40}(document|file|attachment|pdf|docx)/i.test(blob)
  );
}

export type InboundMediaFile = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

export async function saveInboundTelegramFile(file: InboundMediaFile): Promise<CrmAttachment> {
  const original = (file.fileName || "file").split(/[/\\]/).pop() || "file";
  const ext = original.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "bin";
  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", "telegram-inbound");
  await mkdir(dir, { recursive: true });
  const stored = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  await writeFile(path.join(dir, stored), file.buffer);
  return {
    name: original,
    url: `/uploads/telegram-inbound/${stored}`,
    mimeType: file.mimeType || "application/octet-stream",
  };
}

export async function extractInboundMediaText(file: InboundMediaFile): Promise<string> {
  const ext = (file.fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "").toLowerCase();
  if (ext === "txt" || ext === "md" || file.mimeType.startsWith("text/")) {
    return file.buffer.toString("utf8").slice(0, 120_000);
  }
  if (TEXT_EXTS.has(ext)) {
    try {
      return await extractCrmDocumentText(ext === "doc" ? "docx" : ext, file.buffer);
    } catch (cause) {
      return `[Не удалось извлечь текст из ${file.fileName}: ${
        cause instanceof Error ? cause.message : "ошибка"
      }]`;
    }
  }
  if (isCrmImageMime(file.mimeType) || /^(png|jpe?g|webp|gif)$/i.test(ext)) {
    return `[Изображение: ${file.fileName}. Текста нет — учти описание/подпись клиента.]`;
  }
  return `[Файл: ${file.fileName} (${file.mimeType}). Текстовое содержимое недоступно.]`;
}

/** Build the prompt for the sales agent from caption + optional document analysis. */
export function buildInboundPromptWithMedia(input: {
  caption: string;
  analyzed: Array<{ fileName: string; text: string }>;
  storedOnly: Array<{ fileName: string }>;
}) {
  const parts: string[] = [];
  if (input.caption.trim()) parts.push(input.caption.trim());
  if (input.analyzed.length) {
    parts.push("Клиент прислал документ(ы). Разбери содержимое и ответь по делу:");
    for (const doc of input.analyzed) {
      parts.push(`--- Файл: ${doc.fileName} ---\n${doc.text.slice(0, 40_000)}`);
    }
  } else if (input.storedOnly.length) {
    parts.push(
      `Клиент прислал файл(ы): ${input.storedOnly.map((f) => f.fileName).join(", ")}. ` +
        (input.caption.trim()
          ? "Ответь по подписи."
          : "Подтверди получение. В промпте навыка нет указания анализировать вложения — не выдумывай содержимое файла."),
    );
  }
  return parts.join("\n\n").trim();
}
