CREATE TABLE "CrmChannelConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  "config" TEXT NOT NULL DEFAULT '{}',
  "encryptedSecret" TEXT NOT NULL,
  "lastError" TEXT NOT NULL DEFAULT '',
  "lastPolledAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CrmChannelConnection_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmInboundEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "error" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" DATETIME,
  CONSTRAINT "CrmInboundEvent_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "CrmChannelConnection" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CrmOutboxMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "connectionId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "body" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "externalId" TEXT NOT NULL DEFAULT '',
  "error" TEXT NOT NULL DEFAULT '',
  "approvedAt" DATETIME,
  "sentAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CrmOutboxMessage_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "CrmChannelConnection" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmOutboxMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "CrmConversation" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CrmOutboxMessage_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "CrmMessage" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CrmChannelConnection_playbookId_type_key"
  ON "CrmChannelConnection"("playbookId", "type");
CREATE INDEX "CrmChannelConnection_type_status_idx"
  ON "CrmChannelConnection"("type", "status");
CREATE UNIQUE INDEX "CrmInboundEvent_connectionId_externalId_key"
  ON "CrmInboundEvent"("connectionId", "externalId");
CREATE INDEX "CrmInboundEvent_connectionId_status_createdAt_idx"
  ON "CrmInboundEvent"("connectionId", "status", "createdAt");
CREATE UNIQUE INDEX "CrmOutboxMessage_messageId_key"
  ON "CrmOutboxMessage"("messageId");
CREATE INDEX "CrmOutboxMessage_connectionId_status_nextAttemptAt_idx"
  ON "CrmOutboxMessage"("connectionId", "status", "nextAttemptAt");
CREATE INDEX "CrmOutboxMessage_conversationId_createdAt_idx"
  ON "CrmOutboxMessage"("conversationId", "createdAt");
