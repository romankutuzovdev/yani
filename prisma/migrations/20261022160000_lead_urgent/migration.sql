-- Flag leads that need an urgent callback / human reply.
ALTER TABLE "SalesLead" ADD COLUMN "urgentAt" DATETIME;
ALTER TABLE "SalesLead" ADD COLUMN "urgentNote" TEXT NOT NULL DEFAULT '';
