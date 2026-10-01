import mammoth from "mammoth";

/** Extract plain text from a .docx buffer. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) {
    throw new Error("В Word-файле не найден текст");
  }
  // Keep prompt size reasonable
  const maxChars = Number(process.env.MAX_SKILL_DOC_CHARS ?? 80_000);
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n\n[…текст обрезан, всего ${text.length} символов]`;
  }
  return text;
}
