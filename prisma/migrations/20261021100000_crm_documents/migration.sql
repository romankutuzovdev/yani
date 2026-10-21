ALTER TABLE "SalesPlaybook"
  ADD COLUMN "qualificationQuestions" TEXT NOT NULL DEFAULT '';

CREATE TABLE "SalesDocument" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "text" TEXT NOT NULL DEFAULT '',
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "error" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesDocument_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SalesDocument_playbookId_sortOrder_idx"
  ON "SalesDocument"("playbookId", "sortOrder");
