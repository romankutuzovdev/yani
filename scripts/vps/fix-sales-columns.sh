#!/bin/bash
# Apply missing User.sales* columns so login works after sales-plan deploy.
# Run on VPS: bash /root/yani-hotfix/fix-sales-columns.sh
set -eu
APP="${APP:-/var/www/yani}"
DB="$APP/prisma/data/yani.db"

if [ ! -f "$DB" ]; then
  echo "missing db: $DB" >&2
  exit 1
fi

cd "$APP"
node <<'NODE'
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const db = new DatabaseSync(path.join("prisma/data/yani.db"));
const cols = db.prepare("PRAGMA table_info('User')").all().map((r) => r.name);
const add = [
  ['salesEnabled', 'BOOLEAN NOT NULL DEFAULT 0'],
  ['salesPlanName', "TEXT NOT NULL DEFAULT ''"],
  ['salesPlanMonthlyPrice', 'REAL NOT NULL DEFAULT 0'],
  ['salesPlaybookLimit', 'INTEGER NOT NULL DEFAULT 0'],
  ['salesAgentLimit', 'INTEGER NOT NULL DEFAULT 1'],
];
for (const [name, ddl] of add) {
  if (cols.includes(name)) {
    console.log("skip", name);
    continue;
  }
  db.prepare(`ALTER TABLE "User" ADD COLUMN "${name}" ${ddl}`).run();
  console.log("added", name);
}
// Mark migration applied so future prisma migrate deploy does not fail
const mid = "20261022110000_org_sales_plan";
const exists = db.prepare("SELECT 1 AS ok FROM _prisma_migrations WHERE migration_name = ?").get(mid);
if (!exists) {
  db.prepare(
    `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
     VALUES (?, '', datetime('now'), ?, NULL, NULL, datetime('now'), 1)`,
  ).run(crypto.randomUUID(), mid);
  console.log("marked migration", mid);
} else {
  console.log("migration already recorded");
}
console.log("User sales columns:", db.prepare("PRAGMA table_info('User')").all().map((r) => r.name).filter((n) => n.startsWith("sales")));
NODE

systemctl restart yani-app
sleep 2
systemctl is-active yani-app
curl -sS -o /tmp/login-try.json -w "%{http_code}\n" -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@yani.by","password":"__probe__"}' || true
head -c 200 /tmp/login-try.json; echo
echo "OK: sales columns fixed (probe may be 401 invalid password — that is fine; salesEnabled error must be gone)"
