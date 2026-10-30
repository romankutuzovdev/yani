-- Fix login: code expects User.sales* columns (migration 20261022110000).
-- Safe to re-run: skips columns that already exist (SQLite can't IF NOT EXISTS on ADD COLUMN easily).

ALTER TABLE "User" ADD COLUMN "salesEnabled" BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesPlanName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "salesPlanMonthlyPrice" REAL NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesPlaybookLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "salesAgentLimit" INTEGER NOT NULL DEFAULT 1;
