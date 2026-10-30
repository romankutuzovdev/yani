import path from "path";

export type CrmMediaDoc = {
  id: string;
  fileName: string;
  url: string;
  mimeType?: string;
  text?: string;
};

export type CrmAttachment = {
  name: string;
  url: string;
  mimeType: string;
  documentId?: string;
};

/** Name the client sees: the title from the playbook attachment, not the stored hash. */
export function outboundAttachmentName(name: string | undefined, storedPath: string) {
  const raw = (name || "").split(/[/\\]/).pop()?.trim() || "";
  const cleaned = raw.replace(/[\r\n"]/g, "").slice(0, 180);
  if (cleaned) return cleaned;
  return path.basename(storedPath);
}

const IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Markers the model (or manager prompt) may use to attach a real file. */
const FILE_MARKER = /\[\[(?:IMAGE|FILE):([^\]]+)\]\]/gi;

export function isCrmImageMime(mimeType: string) {
  return IMAGE_MIME.has(mimeType.toLowerCase());
}

export function isCrmImageDoc(doc: Pick<CrmMediaDoc, "mimeType" | "fileName">) {
  if (doc.mimeType && isCrmImageMime(doc.mimeType)) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(doc.fileName);
}

export function isCrmPresentationDoc(doc: Pick<CrmMediaDoc, "mimeType" | "fileName">) {
  if (/\.(pptx?|pdf)$/i.test(doc.fileName)) return true;
  return Boolean(doc.mimeType && /(presentation|pdf)/i.test(doc.mimeType));
}

/** Docs whose extracted text trains the agent (knowledge base). */
export function isCrmTrainingDoc(doc: Pick<CrmMediaDoc, "mimeType" | "fileName">) {
  if (isCrmImageDoc(doc)) return false;
  return /\.(docx?|pdf|pptx?|txt|md)$/i.test(doc.fileName)
    || Boolean(doc.mimeType && /pdf|word|officedocument|text|presentation/i.test(doc.mimeType));
}

/**
 * Word/text materials are for grounding only — never auto-send to the client.
 * Presentations, PDF and images stay attachable when explicitly requested.
 */
export function isCrmKnowledgeOnlyDoc(doc: Pick<CrmMediaDoc, "mimeType" | "fileName">) {
  if (isCrmImageDoc(doc) || isCrmPresentationDoc(doc)) return false;
  return /\.(docx?|txt|md|rtf)$/i.test(doc.fileName)
    || Boolean(doc.mimeType && /msword|wordprocessingml|text\/plain|text\/markdown|rtf/i.test(doc.mimeType));
}

export function crmUploadAbsolutePath(url: string) {
  const prefixes = ["/uploads/crm-documents/", "/uploads/email-attachments/"];
  for (const prefix of prefixes) {
    if (!url.startsWith(prefix)) continue;
    const fileName = path.basename(url.slice(prefix.length));
    if (!fileName || fileName !== path.basename(fileName)) return null;
    const folder = prefix.replace(/^\/uploads\//, "").replace(/\/$/, "");
    return path.join(process.cwd(), process.env.UPLOAD_DIR ?? "uploads", folder, fileName);
  }
  return null;
}

export function listPlaybookImages(documents: CrmMediaDoc[]) {
  return documents.filter(isCrmImageDoc);
}

/** Any material with a stored binary that can be sent as a real attachment. */
export function listSendableFiles(documents: CrmMediaDoc[]) {
  return documents.filter((doc) => Boolean(doc.url?.startsWith("/uploads/")));
}

/** Files the agent may attach: presentations, PDF, images — not DOCX knowledge base. */
export function listAttachableFiles(documents: CrmMediaDoc[]) {
  return listSendableFiles(documents).filter((doc) => !isCrmKnowledgeOnlyDoc(doc));
}

function resolveDoc(documents: CrmMediaDoc[], ref: string) {
  const key = String(ref || "").trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  const base = path.basename(key).toLowerCase();
  return (
    documents.find((item) => item.fileName.toLowerCase() === lower)
    || documents.find((item) => item.url === key)
    || documents.find((item) => item.fileName.toLowerCase() === base)
    || documents.find((item) => path.basename(item.url).toLowerCase() === base)
    || null
  );
}

function pushAttachment(
  attachments: CrmAttachment[],
  seen: Set<string>,
  doc: CrmMediaDoc,
) {
  if (seen.has(doc.id)) return;
  seen.add(doc.id);
  attachments.push({
    name: doc.fileName,
    url: doc.url,
    mimeType: doc.mimeType || (isCrmImageDoc(doc) ? "image/jpeg" : "application/octet-stream"),
    documentId: doc.id,
  });
}

/** Client asks to send a presentation, PDF or image (not a vague mention of «файл» in prompts). */
export function wantsFileAttachment(text: string) {
  return /(прилож|прикреп|скин[ьу]|перешл|вышл|пришли|пришлите|отправь\s+(мне\s+)?(файл|презентац|слайд|pdf|картинк|фото)|презентац|слайд|deck|pitch|баннер|картинк|фото|изображен|\.pptx?\b|\.pdf\b|\.png\b|\.jpe?g\b|\.webp\b|\.gif\b)/i.test(
    text,
  );
}

/** Explicit request for a Word/DOC knowledge file as an attachment. */
export function wantsKnowledgeDocAttachment(text: string) {
  return /(прилож|прикреп|скин[ьу]|пришли|пришлите|отправь).{0,40}(документ|docx?|\.doc\b|ворд|word)|(?:документ|docx?|\.doc\b).{0,20}(прилож|прикреп|скин|пришли|отправ)/i.test(
    text,
  );
}

/**
 * Catalog for the LLM:
 * - extracted text of docs = knowledge base (facts)
 * - pptx/pdf/images = real file attachments when asked
 * - DOCX/TXT = knowledge only, do not attach by default
 */
export function attachmentCatalogText(documents: CrmMediaDoc[]) {
  const attachable = listAttachableFiles(documents);
  const knowledgeOnly = listSendableFiles(documents).filter(isCrmKnowledgeOnlyDoc);
  const images = attachable.filter(isCrmImageDoc);
  const presentations = attachable.filter((doc) => isCrmPresentationDoc(doc) && !isCrmImageDoc(doc));
  const other = attachable.filter((doc) => !isCrmImageDoc(doc) && !isCrmPresentationDoc(doc));
  if (!attachable.length && !knowledgeOnly.length) return "";

  const lines = [
    "Вложения клиенту — только настоящие файлы из списка ниже. Не копируй содержимое файла в текст сообщения.",
    "DOCX/TXT — база знаний: отвечай по фактам из текста, НЕ прикрепляй эти файлы, пока клиент явно не попросил прислать документ Word.",
    "Презентацию, PDF или картинку прикрепляй маркером [[FILE:точное_имя]] или [[IMAGE:имя]] отдельной строкой в конце — только если клиент просит показать или прислать файл.",
    "Не выдумывай имена — только из списка ниже.",
  ];
  if (presentations.length) {
    lines.push("Презентации и PDF (можно прикрепить файлом по запросу):");
    for (const [index, file] of presentations.entries()) {
      lines.push(`${index + 1}. ${file.fileName} · ${file.mimeType ?? "file"}`);
    }
  }
  if (images.length) {
    lines.push("Картинки (можно прикрепить файлом по запросу):");
    for (const [index, image] of images.entries()) {
      lines.push(`${index + 1}. ${image.fileName} · ${image.mimeType ?? "image"}`);
    }
  }
  if (other.length) {
    lines.push("Другие вложения (по запросу):");
    for (const [index, file] of other.entries()) {
      lines.push(`${index + 1}. ${file.fileName} · ${file.mimeType ?? "file"}`);
    }
  }
  if (knowledgeOnly.length) {
    lines.push("Только база знаний (не прикрепляй, пока не попросят документ Word):");
    for (const [index, file] of knowledgeOnly.entries()) {
      lines.push(`${index + 1}. ${file.fileName}`);
    }
  }
  return lines.join("\n");
}

/** @deprecated use attachmentCatalogText */
export function imageCatalogText(documents: CrmMediaDoc[]) {
  return attachmentCatalogText(documents);
}

function attachByIntent(
  attachable: CrmMediaDoc[],
  hintBlob: string,
  attachments: CrmAttachment[],
  seen: Set<string>,
) {
  if (!hintBlob || !wantsFileAttachment(hintBlob)) return;

  const wantsPresentation = /(презентац|слайд|deck|pitch|\.pptx?\b|\.pdf\b)/i.test(hintBlob);
  const wantsImage = /(картинк|фото|баннер|изображен|\.png\b|\.jpe?g\b|\.webp\b|\.gif\b)/i.test(hintBlob);

  // Exact filename among attachable files wins.
  for (const doc of attachable) {
    const name = doc.fileName;
    if (name.length < 3) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^\\w.])${escaped}(?:$|[^\\w.])`, "i").test(hintBlob)) {
      pushAttachment(attachments, seen, doc);
    }
  }
  if (seen.size) return;

  if (wantsPresentation) {
    const deck = attachable.find((doc) => /\.pptx?$/i.test(doc.fileName))
      || attachable.find((doc) => isCrmPresentationDoc(doc));
    if (deck) pushAttachment(attachments, seen, deck);
  }
  if (wantsImage) {
    const image = attachable.find(isCrmImageDoc);
    if (image) pushAttachment(attachments, seen, image);
  }
}

function allowKnowledgeDocAttach(doc: CrmMediaDoc, clientHint: string) {
  if (!isCrmKnowledgeOnlyDoc(doc)) return true;
  if (!clientHint.trim()) return false;
  if (wantsKnowledgeDocAttachment(clientHint)) return true;
  const name = doc.fileName;
  if (name.length < 3) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\w.])${escaped}(?:$|[^\\w.])`, "i").test(clientHint);
}

/**
 * Pull [[IMAGE:]] / [[FILE:]] markers and filenames / intents from hints,
 * resolve against playbook materials, return clean body + real file attachments.
 * DOCX/TXT knowledge files are not attached unless the client asked for them.
 */
export function finalizeCrmDraft(
  raw: string,
  documents: CrmMediaDoc[],
  hints: string[] = [],
) {
  const sendable = listSendableFiles(documents);
  const attachable = listAttachableFiles(documents);
  const attachments: CrmAttachment[] = [];
  const seen = new Set<string>();
  const clientHint = hints.filter(Boolean).join("\n");

  const body = raw
    .replace(FILE_MARKER, (_full, ref: string) => {
      const doc = resolveDoc(sendable, ref);
      if (doc && allowKnowledgeDocAttach(doc, clientHint)) {
        pushAttachment(attachments, seen, doc);
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Intent attach only from client/manager hints — not from the model reply text
  // (otherwise «файл» in the draft or a stray [[FILE:docx]] path re-triggers DOCX).
  attachByIntent(attachable, clientHint, attachments, seen);

  return { body: body || raw.trim(), attachments };
}
