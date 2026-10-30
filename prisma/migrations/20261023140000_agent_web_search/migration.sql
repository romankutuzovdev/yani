-- Per-agent switch: search the web (Yandex) and read public pages.
ALTER TABLE "Agent" ADD COLUMN "webSearchEnabled" BOOLEAN NOT NULL DEFAULT 0;
