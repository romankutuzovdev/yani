CREATE TABLE "CrmImportJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "reportJson" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  CONSTRAINT "CrmImportJob_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmImportJob_playbookId_createdAt_idx"
  ON "CrmImportJob"("playbookId", "createdAt");

CREATE TABLE "CrmCampaign" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'EMAIL',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "subject" TEXT NOT NULL DEFAULT '',
  "bodyTemplate" TEXT NOT NULL DEFAULT '',
  "dailyLimit" INTEGER NOT NULL DEFAULT 40,
  "intervalSeconds" INTEGER NOT NULL DEFAULT 90,
  "quietHoursStart" INTEGER,
  "quietHoursEnd" INTEGER,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Minsk',
  "sentToday" INTEGER NOT NULL DEFAULT 0,
  "sentTodayDate" TEXT NOT NULL DEFAULT '',
  "importJobId" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "stoppedAt" DATETIME,
  CONSTRAINT "CrmCampaign_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmCampaign_playbookId_status_updatedAt_idx"
  ON "CrmCampaign"("playbookId", "status", "updatedAt");
CREATE INDEX "CrmCampaign_status_updatedAt_idx"
  ON "CrmCampaign"("status", "updatedAt");

CREATE TABLE "CrmCampaignItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "campaignId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outboxId" TEXT NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "processedAt" DATETIME,
  CONSTRAINT "CrmCampaignItem_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "CrmCampaign" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmCampaignItem_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "SalesLead" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmCampaignItem_campaignId_leadId_key"
  ON "CrmCampaignItem"("campaignId", "leadId");
CREATE INDEX "CrmCampaignItem_campaignId_status_scheduledAt_idx"
  ON "CrmCampaignItem"("campaignId", "status", "scheduledAt");
CREATE INDEX "CrmCampaignItem_status_scheduledAt_idx"
  ON "CrmCampaignItem"("status", "scheduledAt");
