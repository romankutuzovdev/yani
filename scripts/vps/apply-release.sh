#!/bin/bash
# Apply yani-release.tgz on the VPS (/var/www/yani) and restart systemd units.
# Usage (as root on the server):
#   APP=/var/www/yani REL=/root/yani-release.tgz bash scripts/vps/apply-release.sh
# Or after unpacking a new tree that already contains this script:
#   bash /tmp/apply-release.sh
set -eu

APP="${APP:-/var/www/yani}"
REL="${REL:-/root/yani-release.tgz}"
STAGE="${STAGE:-/root/yani-staging}"
KEEP="${KEEP:-/root/yani-keep}"

if [ ! -f "$REL" ]; then
  echo "missing $REL" >&2
  exit 1
fi

mkdir -p "$KEEP"
cp -a "$APP/.env" "$KEEP/env"
rm -rf "$KEEP/data" "$KEEP/uploads"
if [ -d "$APP/prisma/data" ]; then
  cp -a "$APP/prisma/data" "$KEEP/data"
fi
if [ -d "$APP/uploads" ]; then
  cp -a "$APP/uploads" "$KEEP/uploads"
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
# macOS tar may embed Apple xattrs — silence unknown-header noise on GNU tar.
tar --warning=no-unknown-keyword -xzf "$REL" -C "$STAGE" 2>/tmp/yani-tar.err || {
  cat /tmp/yani-tar.err >&2
  exit 1
}
grep -v 'LIBARCHIVE.xattr\|SCHILY.xattr\|Ignoring unknown extended header' /tmp/yani-tar.err >&2 || true
rm -f "$STAGE/.env"

cp -a "$KEEP/env" "$STAGE/.env"
mkdir -p "$STAGE/prisma" "$STAGE/uploads"
if [ -d "$KEEP/data" ]; then
  rm -rf "$STAGE/prisma/data"
  cp -a "$KEEP/data" "$STAGE/prisma/data"
fi
if [ -d "$KEEP/uploads" ]; then
  rm -rf "$STAGE/uploads"
  cp -a "$KEEP/uploads" "$STAGE/uploads"
fi

systemctl stop yani-crm-telegram yani-crm-email yani-crm-worker yani-app 2>/dev/null || true

rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.env' \
  --exclude '/prisma/data/' \
  --exclude '/uploads/' \
  "$STAGE/" "$APP/"

cp -a "$KEEP/env" "$APP/.env"
mkdir -p "$APP/prisma/data" "$APP/uploads"
if [ -d "$KEEP/data" ]; then
  rsync -a "$KEEP/data/" "$APP/prisma/data/"
fi
if [ -d "$KEEP/uploads" ]; then
  rsync -a "$KEEP/uploads/" "$APP/uploads/"
fi

cd "$APP"

# Upload limit 80MB
if grep -q '^MAX_UPLOAD_DOC_BYTES=' .env 2>/dev/null; then
  sed -i 's/^MAX_UPLOAD_DOC_BYTES=.*/MAX_UPLOAD_DOC_BYTES=83886080/' .env
else
  echo 'MAX_UPLOAD_DOC_BYTES=83886080' >> .env
fi

# Safe additive schema fixes (sales plan + playbook channels) if migrate deploy skipped.
node <<'NODE' || true
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const db = new DatabaseSync("prisma/data/yani.db");
function addCols(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((r) => r.name));
  for (const [name, ddl] of cols) {
    if (have.has(name)) continue;
    db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${ddl}`).run();
    console.log("schema+", table, name);
  }
}
addCols("User", [
  ["salesEnabled", "BOOLEAN NOT NULL DEFAULT 0"],
  ["salesPlanName", "TEXT NOT NULL DEFAULT ''"],
  ["salesPlanMonthlyPrice", "REAL NOT NULL DEFAULT 0"],
  ["salesPlaybookLimit", "INTEGER NOT NULL DEFAULT 0"],
  ["salesAgentLimit", "INTEGER NOT NULL DEFAULT 1"],
]);
addCols("SalesPlaybook", [
  ["channelTelegramEnabled", "BOOLEAN NOT NULL DEFAULT 1"],
  ["channelEmailEnabled", "BOOLEAN NOT NULL DEFAULT 1"],
]);
addCols("SalesLead", [
  ["urgentAt", "DATETIME"],
  ["urgentNote", "TEXT NOT NULL DEFAULT ''"],
]);
addCols("Agent", [
  ["webSearchEnabled", "BOOLEAN NOT NULL DEFAULT 0"],
]);
addCols("CrmCampaign", [
  ["contactListIds", "TEXT NOT NULL DEFAULT '[]'"],
]);
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "CrmContactList" (
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
    CREATE INDEX IF NOT EXISTS "CrmContactList_playbookId_channel_updatedAt_idx"
      ON "CrmContactList"("playbookId", "channel", "updatedAt");
    CREATE UNIQUE INDEX IF NOT EXISTS "CrmContactList_playbookId_name_channel_key"
      ON "CrmContactList"("playbookId", "name", "channel");
    CREATE TABLE IF NOT EXISTS "CrmContactListItem" (
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
    CREATE INDEX IF NOT EXISTS "CrmContactListItem_listId_updatedAt_idx"
      ON "CrmContactListItem"("listId", "updatedAt");
    CREATE INDEX IF NOT EXISTS "CrmContactListItem_listId_email_idx"
      ON "CrmContactListItem"("listId", "email");
    CREATE INDEX IF NOT EXISTS "CrmContactListItem_listId_telegram_idx"
      ON "CrmContactListItem"("listId", "telegram");
  `);
} catch (e) {
  console.warn("contact lists schema:", e);
}
db.prepare("UPDATE User SET salesEnabled = 1 WHERE role = 'ORG' AND (salesEnabled = 0 OR salesEnabled IS NULL)").run();
try {
  db.prepare('CREATE INDEX IF NOT EXISTS "CrmMessage_direction_status_idx" ON "CrmMessage"("direction", "status")').run();
} catch {}
for (const mid of ["20261022110000_org_sales_plan", "20261022140000_playbook_channels", "20261022160000_lead_urgent", "20261023140000_agent_web_search", "20261023180000_crm_message_status_index", "20261026120000_crm_contact_lists"]) {
  if (!db.prepare("SELECT 1 FROM _prisma_migrations WHERE migration_name = ?").get(mid)) {
    db.prepare(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES (?, '', datetime('now'), ?, NULL, NULL, datetime('now'), 1)`).run(crypto.randomUUID(), mid);
  }
}
console.log("schema ok");
NODE

if [ -d prisma/migrations ] && command -v npx >/dev/null 2>&1; then
  npx --yes prisma migrate deploy 2>/dev/null || true
fi

# Ensure worker/node deps for telegram/email exist in standalone tree.
if [ -f package.json ] && [ ! -d node_modules/telegram ]; then
  npm install --omit=dev --no-audit --no-fund 2>/dev/null || true
fi

# nginx upload body limit if our vhost is installed
if [ -f /etc/nginx/sites-available/yani ]; then
  if grep -q 'client_max_body_size' /etc/nginx/sites-available/yani; then
    sed -i 's/client_max_body_size .*/client_max_body_size 80m;/' /etc/nginx/sites-available/yani || true
  else
    sed -i '/server_name/a\  client_max_body_size 80m;' /etc/nginx/sites-available/yani || true
  fi
  nginx -t 2>/dev/null && systemctl reload nginx || true
fi

if [ -x "$APP/scripts/vps/install-systemd.sh" ]; then
  bash "$APP/scripts/vps/install-systemd.sh"
else
  systemctl start yani-app yani-crm-email yani-crm-telegram yani-crm-worker 2>/dev/null || true
  systemctl restart yani-app yani-crm-email yani-crm-telegram yani-crm-worker 2>/dev/null || true
fi

sleep 2
systemctl is-active yani-app yani-crm-email yani-crm-telegram yani-crm-worker || true
curl -sI http://127.0.0.1:3000/login | head -3 || true
curl -sS http://127.0.0.1:3000/api/v1/agents/by-slug/primary | head -c 120 || true
echo
echo "OK: release applied at $APP"
