#!/bin/bash
# Apply a prebuilt Next.js standalone tarball on hoster.by.
# Run without profile scripts so nvm does not spawn extra processes:
#   bash --noprofile --norc scripts/hoster/apply-release.sh
set -eu

APP="${HOME}/www/yani.by"
REL="${HOME}/yani-release.tgz"
STAGE="${HOME}/yani-staging"
NODE="/var/www/h209040/data/.nvm/versions/node/v22.23.3/bin/node"
KEEP="${HOME}/yani-keep"

if [ ! -f "$REL" ]; then
  echo "missing $REL" >&2
  exit 1
fi
if [ ! -x "$NODE" ]; then
  echo "missing node at $NODE" >&2
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
tar -xzf "$REL" -C "$STAGE"
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

# The site proxy on this host listens on 10020. The Node process is often
# titled next-server, not "node server.js", so match by working directory.
LIVE_PORT=""
kill_pids=""
while read -r pid args; do
  [ -n "$pid" ] || continue
  cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
  case "$cwd" in
    "$APP"|"$APP/"*) ;;
    *) continue ;;
  esac
  if [ -r "/proc/${pid}/environ" ]; then
    port="$(tr '\0' '\n' < "/proc/${pid}/environ" | sed -n 's/^PORT=//p' | head -1)"
    if [ -n "$port" ]; then
      LIVE_PORT="$port"
    fi
  fi
  kill_pids="${kill_pids} ${pid}"
done <<EOF
$(ps -u "$(id -u)" -o pid=,args= | awk '/next-server|[n]ode server\.js/ {print}')
EOF

# Anchor excludes to the site root. A bare "uploads/" also skips
  # .next/server/app/uploads, so the video route never updates.
rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.env' \
  --exclude '/prisma/data/' \
  --exclude '/uploads/' \
  "$STAGE/" "$APP/"

cp -a "$KEEP/env" "$APP/.env"
mkdir -p "$APP/prisma" "$APP/uploads"
if [ -d "$KEEP/data" ]; then
  rm -rf "$APP/prisma/data"
  cp -a "$KEEP/data" "$APP/prisma/data"
fi
if [ -d "$KEEP/uploads" ]; then
  rm -rf "$APP/uploads"
  cp -a "$KEEP/uploads" "$APP/uploads"
fi

# Chat menu documents + CRM migrations. Safe to repeat; do not use prisma db push.
if [ -f "$APP/prisma/data/yani.db" ]; then
  "$NODE" - "$APP/prisma/data/yani.db" "$APP/prisma/migrations" << 'JS'
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const dbPath = process.argv[1] === "-" ? process.argv[2] : process.argv[1];
const migrationsDir = process.argv[1] === "-" ? process.argv[3] : process.argv[2];
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS "AgentDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT 'text/plain',
    "openMode" TEXT NOT NULL DEFAULT 'preview',
    "text" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL,
    CONSTRAINT "AgentDoc_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "AgentDoc_agentId_sortOrder_idx" ON "AgentDoc"("agentId", "sortOrder");
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  );
`);
function addColumn(sql) {
  try {
    db.exec(sql);
  } catch (err) {
    if (!/duplicate column/i.test(String(err && err.message || err))) throw err;
  }
}
addColumn('ALTER TABLE "User" ADD COLUMN "planName" TEXT NOT NULL DEFAULT \'\'');
addColumn('ALTER TABLE "User" ADD COLUMN "planMonthlyPrice" REAL NOT NULL DEFAULT 0');
addColumn('ALTER TABLE "User" ADD COLUMN "salesEnabled" INTEGER NOT NULL DEFAULT 0');
addColumn('ALTER TABLE "User" ADD COLUMN "salesPlanName" TEXT NOT NULL DEFAULT \'\'');
addColumn('ALTER TABLE "User" ADD COLUMN "salesPlanMonthlyPrice" REAL NOT NULL DEFAULT 0');
addColumn('ALTER TABLE "User" ADD COLUMN "salesPlaybookLimit" INTEGER NOT NULL DEFAULT 0');
addColumn('ALTER TABLE "User" ADD COLUMN "salesAgentLimit" INTEGER NOT NULL DEFAULT 1');
addColumn('ALTER TABLE "Agent" ADD COLUMN "isPrimary" INTEGER NOT NULL DEFAULT 0');
addColumn('ALTER TABLE "Agent" ADD COLUMN "webSearchEnabled" INTEGER NOT NULL DEFAULT 0');
const marked = db.prepare('SELECT COUNT(*) AS n FROM "Agent" WHERE "isPrimary" = 1').get();
if (!marked || Number(marked.n) === 0) {
  const pick = db.prepare(
    'SELECT id FROM "Agent" WHERE slug = ? OR name = ? ORDER BY CASE WHEN slug = ? THEN 0 ELSE 1 END LIMIT 1'
  ).get('yani', 'Yani', 'yani');
  if (pick && pick.id) {
    db.prepare('UPDATE "Agent" SET "isPrimary" = 0').run();
    db.prepare('UPDATE "Agent" SET "isPrimary" = 1 WHERE id = ?').run(pick.id);
  }
}

if (migrationsDir && fs.existsSync(migrationsDir)) {
  const applied = new Set(
    db.prepare('SELECT migration_name FROM "_prisma_migrations"').all().map((row) => row.migration_name),
  );
  const dirs = fs.readdirSync(migrationsDir).filter((name) => name.startsWith("2026") || name.startsWith("20")).sort();
  for (const name of dirs) {
    if (applied.has(name)) continue;
    const sqlPath = path.join(migrationsDir, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf8");
    try {
      db.exec("BEGIN");
      db.exec(sql);
      db.prepare(
        "INSERT INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, datetime('now'), ?, 1)",
      ).run(name, "hoster-apply", name);
      db.exec("COMMIT");
      console.log("applied migration", name);
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch {}
      // Partial CRM DBs may already have objects from a previous manual patch.
      if (/already exists|duplicate column/i.test(String(err && err.message || err))) {
        db.prepare(
          "INSERT OR IGNORE INTO \"_prisma_migrations\" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, datetime('now'), ?, 1)",
        ).run(name, "hoster-apply-exists", name);
        console.log("migration already present", name);
        continue;
      }
      throw err;
    }
  }
}
JS
fi

if [ -n "${kill_pids# }" ]; then
  # shellcheck disable=SC2086
  kill $kill_pids 2>/dev/null || true
  sleep 1
  # shellcheck disable=SC2086
  kill -9 $kill_pids 2>/dev/null || true
  sleep 1
fi

# CageFS hides next-server from ps, but the threads can still be signalled.
python3 - << 'PY'
import os
def listening(port):
    try:
        lines = open("/proc/net/tcp").read().splitlines()[1:]
    except OSError:
        return False
    for line in lines:
        parts = line.split()
        local_port = int(parts[1].rsplit(":", 1)[1], 16)
        if local_port == port and parts[3] == "0A":
            return True
    return False
if not listening(10020):
    raise SystemExit
me = {os.getpid(), os.getppid()}
hidden = []
for pid in range(1, 4200000):
    if pid in me:
        continue
    try:
        os.kill(pid, 0)
    except OSError:
        continue
    if os.path.exists(f"/proc/{pid}/cmdline"):
        continue
    hidden.append(pid)
if hidden:
    os.kill(min(hidden), 9)
PY
sleep 1

set -a
# shellcheck disable=SC1091
. "$APP/.env"
set +a
if [ -n "$LIVE_PORT" ]; then
  export PORT="$LIVE_PORT"
fi
# Nginx for yani.by proxies to 10020. .env may still say 3000.
if [ "${PORT:-3000}" = "3000" ]; then
  export PORT=10020
fi
export NODE_ENV=production
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

cd "$APP"
nohup "$NODE" server.js >> "${HOME}/yani-app.log" 2>&1 &
echo $! > "${HOME}/yani.pid"
echo "started pid $(cat "${HOME}/yani.pid") port ${PORT:-3000}"

# CRM background workers (Telegram / email / campaigns). One process set for all agents.
stop_crm_workers() {
  while read -r pid args; do
    [ -n "$pid" ] || continue
    cwd="$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)"
    case "$cwd" in
      "$APP"|"$APP/"*) ;;
      *) continue ;;
    esac
    case "$args" in
      *crm-telegram-worker*|*crm-email-worker*|*crm-worker*) kill "$pid" 2>/dev/null || true ;;
    esac
  done <<EOF
$(ps -u "$(id -u)" -o pid=,args= | awk '/crm-(telegram|email)?-?worker/ {print}')
EOF
}
stop_crm_workers
sleep 1
if [ -f "$APP/crm-workers/crm-telegram-worker.js" ]; then
  nohup "$NODE" crm-workers/crm-telegram-worker.js >> "${HOME}/yani-crm-telegram.log" 2>&1 &
  echo $! > "${HOME}/yani-crm-telegram.pid"
  echo "crm telegram worker pid $(cat "${HOME}/yani-crm-telegram.pid")"
fi
if [ -f "$APP/crm-workers/crm-email-worker.js" ]; then
  nohup "$NODE" crm-workers/crm-email-worker.js >> "${HOME}/yani-crm-email.log" 2>&1 &
  echo $! > "${HOME}/yani-crm-email.pid"
  echo "crm email worker pid $(cat "${HOME}/yani-crm-email.pid")"
fi
if [ -f "$APP/crm-workers/crm-worker.js" ]; then
  nohup "$NODE" crm-workers/crm-worker.js >> "${HOME}/yani-crm-worker.log" 2>&1 &
  echo $! > "${HOME}/yani-crm-worker.pid"
  echo "crm worker pid $(cat "${HOME}/yani-crm-worker.pid")"
fi
