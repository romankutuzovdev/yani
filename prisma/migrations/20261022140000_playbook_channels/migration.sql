-- Enable Telegram / Email communication per playbook (checkboxes; both allowed).
ALTER TABLE "SalesPlaybook" ADD COLUMN "channelTelegramEnabled" BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE "SalesPlaybook" ADD COLUMN "channelEmailEnabled" BOOLEAN NOT NULL DEFAULT 1;
