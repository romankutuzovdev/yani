CREATE TABLE "SalesPlaybook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "goals" TEXT NOT NULL DEFAULT '',
    "communicationStyle" TEXT NOT NULL DEFAULT '',
    "restrictions" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'STOPPED',
    "sendMode" TEXT NOT NULL DEFAULT 'APPROVAL_REQUIRED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesPlaybook_agentId_fkey"
      FOREIGN KEY ("agentId") REFERENCES "Agent" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "SalesLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playbookId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "telegram" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "notes" TEXT NOT NULL DEFAULT '',
    "agentInstruction" TEXT NOT NULL DEFAULT '',
    "lastContactAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesLead_playbookId_fkey"
      FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "LeadIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playbookId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "originalValue" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadIdentity_playbookId_fkey"
      FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeadIdentity_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "SalesLead" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalThreadId" TEXT NOT NULL DEFAULT '',
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrmConversation_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "SalesLead" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "body" TEXT NOT NULL,
    "externalId" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmMessage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "CrmConversation" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SalesPlaybook_agentId_name_key"
  ON "SalesPlaybook"("agentId", "name");
CREATE INDEX "SalesPlaybook_agentId_status_idx"
  ON "SalesPlaybook"("agentId", "status");

CREATE INDEX "SalesLead_playbookId_stage_updatedAt_idx"
  ON "SalesLead"("playbookId", "stage", "updatedAt");
CREATE INDEX "SalesLead_playbookId_lastContactAt_idx"
  ON "SalesLead"("playbookId", "lastContactAt");

CREATE UNIQUE INDEX "LeadIdentity_playbookId_type_value_key"
  ON "LeadIdentity"("playbookId", "type", "value");
CREATE INDEX "LeadIdentity_leadId_idx"
  ON "LeadIdentity"("leadId");

CREATE UNIQUE INDEX "CrmConversation_leadId_channel_key"
  ON "CrmConversation"("leadId", "channel");
CREATE INDEX "CrmConversation_leadId_lastMessageAt_idx"
  ON "CrmConversation"("leadId", "lastMessageAt");

CREATE INDEX "CrmMessage_conversationId_createdAt_idx"
  ON "CrmMessage"("conversationId", "createdAt");
