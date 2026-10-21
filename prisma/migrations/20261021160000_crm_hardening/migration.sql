CREATE TABLE "CrmAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT,
  "agentId" TEXT,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL DEFAULT '',
  "entityId" TEXT NOT NULL DEFAULT '',
  "summary" TEXT NOT NULL,
  "meta" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrmAuditEvent_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CrmAuditEvent_playbookId_createdAt_idx" ON "CrmAuditEvent"("playbookId", "createdAt");
CREATE INDEX "CrmAuditEvent_action_createdAt_idx" ON "CrmAuditEvent"("action", "createdAt");
CREATE INDEX "CrmAuditEvent_entityType_entityId_idx" ON "CrmAuditEvent"("entityType", "entityId");

CREATE TABLE "CrmDeadLetter" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL DEFAULT '',
  "outboxId" TEXT NOT NULL DEFAULT '',
  "messageId" TEXT NOT NULL DEFAULT '',
  "channel" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "attempts" INT NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "CrmDeadLetter_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmDeadLetter_playbookId_createdAt_idx" ON "CrmDeadLetter"("playbookId", "createdAt");
CREATE INDEX "CrmDeadLetter_resolvedAt_createdAt_idx" ON "CrmDeadLetter"("resolvedAt", "createdAt");
