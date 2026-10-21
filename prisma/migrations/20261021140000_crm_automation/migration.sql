ALTER TABLE "SalesLead"
  ADD COLUMN "agentPaused" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LeadFieldChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "leadId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "oldValue" TEXT NOT NULL DEFAULT '',
  "newValue" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'AUTO',
  "confidence" REAL NOT NULL DEFAULT 1,
  "evidence" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeadFieldChange_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "SalesLead" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "LeadFieldChange_leadId_createdAt_idx"
  ON "LeadFieldChange"("leadId", "createdAt");
