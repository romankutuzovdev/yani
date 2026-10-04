import mammoth from "mammoth";

/** Keep skill source text inside the model context. */
export function clampSkillText(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const maxChars = Number(process.env.MAX_SKILL_DOC_CHARS ?? 80_000);
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}\n\n[…текст обрезан, всего ${text.length} символов]`;
  }
  return text;
}

/** Extract plain text from a .docx buffer. */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  const text = clampSkillText(result.value || "");
  if (!text) {
    throw new Error("В Word-файле не найден текст");
  }
  return text;
}

/** Plain .txt / .md upload. */
export function extractPlainText(buffer: Buffer): string {
  const text = clampSkillText(buffer.toString("utf8"));
  if (!text) {
    throw new Error("В файле не найден текст");
  }
  return text;
}
