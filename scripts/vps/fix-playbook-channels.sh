#!/bin/bash
# Add SalesPlaybook channelTelegramEnabled / channelEmailEnabled columns.
set -eu
APP="${APP:-/var/www/yani}"
cd "$APP"
node <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");
const db = new DatabaseSync("prisma/data/yani.db");
const cols = new Set(db.prepare("PRAGMA table_info('SalesPlaybook')").all().map((r) => r.name));
const add = [
  ["channelTelegramEnabled", "BOOLEAN NOT NULL DEFAULT 1"],
  ["channelEmailEnabled", "BOOLEAN NOT NULL DEFAULT 1"],
];
for (const [name, ddl] of add) {
  if (cols.has(name)) { console.log("skip", name); continue; }
  db.prepare(`ALTER TABLE "SalesPlaybook" ADD COLUMN "${name}" ${ddl}`).run();
  console.log("added", name);
}
const mid = "20261022140000_playbook_channels";
if (!db.prepare("SELECT 1 FROM _prisma_migrations WHERE migration_name = ?").get(mid)) {
  db.prepare(`INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
    VALUES (?, '', datetime('now'), ?, NULL, NULL, datetime('now'), 1)`).run(crypto.randomUUID(), mid);
  console.log("marked", mid);
}
console.log("ok");
NODE
systemctl restart yani-app yani-crm-telegram yani-crm-email 2>/dev/null || systemctl restart yani-app
echo "restarted"
