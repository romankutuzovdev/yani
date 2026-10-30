-- Named EMAIL / TELEGRAM contact lists for outbound first-touch campaigns.
CREATE TABLE "CrmContactList" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "playbookId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CrmContactList_playbookId_fkey"
    FOREIGN KEY ("playbookId") REFERENCES "SalesPlaybook" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmContactList_playbookId_channel_updatedAt_idx"
  ON "CrmContactList"("playbookId", "channel", "updatedAt");
CREATE UNIQUE INDEX "CrmContactList_playbookId_name_channel_key"
  ON "CrmContactList"("playbookId", "name", "channel");

CREATE TABLE "CrmContactListItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "listId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL DEFAULT '',
  "company" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "telegram" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CrmContactListItem_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "CrmContactList" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CrmContactListItem_listId_updatedAt_idx"
  ON "CrmContactListItem"("listId", "updatedAt");
CREATE INDEX "CrmContactListItem_listId_email_idx"
  ON "CrmContactListItem"("listId", "email");
CREATE INDEX "CrmContactListItem_listId_telegram_idx"
  ON "CrmContactListItem"("listId", "telegram");

ALTER TABLE "CrmCampaign" ADD COLUMN "contactListIds" TEXT NOT NULL DEFAULT '[]';
