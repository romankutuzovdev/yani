-- Organization sales / CRM tariff controlled from admin agent access.
ALTER TABLE "User" ADD COLUMN "salesEnabled" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesPlanName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "salesPlanMonthlyPrice" REAL NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesPlaybookLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesAgentLimit" INTEGER NOT NULL DEFAULT 1;
