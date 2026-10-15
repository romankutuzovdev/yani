import { prisma } from "@/lib/db";
import { clampSkillText } from "@/lib/docx";

/** Keep in sync with SkillDocs UI. */
export const MAX_SKILL_DOCS = 15;

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS "SkillDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "skillId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "url" TEXT NOT NULL DEFAULT '',
  "mimeType" Text NOT NULL DEFAULT 'text/plain',
  "text" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkillDocument_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`;

let ensured = false;

export async function ensureSkillDocumentTable() {
  if (ensured) return;
  await prisma.$executeRawUnsafe(TABLE_SQL);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "SkillDocument_skillId_sortOrder_idx" ON "SkillDocument"("skillId", "sortOrder")`,
  );
  ensured = true;
}

/** Move the old single Skill.document* fields into SkillDocument once. */
export async function migrateLegacySkillDocument(skillId: string) {
  await ensureSkillDocumentTable();
  const count = await prisma.skillDocument.count({ where: { skillId } });
  if (count > 0) return;
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { documentName: true, documentUrl: true, documentText: true },
  });
  if (!skill?.documentText?.trim() && !skill?.documentName?.trim()) return;
  await prisma.skillDocument.create({
    data: {
      skillId,
      fileName: skill.documentName?.trim() || "Документ",
      url: skill.documentUrl || "",
      mimeType: skill.documentUrl?.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "text/plain",
      text: skill.documentText || "",
      sortOrder: 0,
    },
  });
}

/** Keep Skill.document* in sync so AgentEngine keeps reading one field. */
export async function syncSkillDocumentAggregate(skillId: string) {
  await ensureSkillDocumentTable();
  const docs = await prisma.skillDocument.findMany({
    where: { skillId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { fileName: true, url: true, text: true },
  });
  if (!docs.length) {
    await prisma.skill.update({
      where: { id: skillId },
      data: { documentUrl: "", documentName: "", documentText: "" },
    });
    return;
  }
  const names = docs.map((d) => d.fileName).filter(Boolean);
  const documentName =
    names.length <= 2 ? names.join(", ") : `${names.length} файла`;
  const joined = docs
    .map((d) => {
      const label = d.fileName || "файл";
      const body = (d.text || "").trim();
      return body ? `=== ${label} ===\n${body}` : `=== ${label} ===`;
    })
    .join("\n\n");
  await prisma.skill.update({
    where: { id: skillId },
    data: {
      documentUrl: docs.find((d) => d.url)?.url || "",
      documentName: documentName.slice(0, 240),
      documentText: clampSkillText(joined),
    },
  });
}
