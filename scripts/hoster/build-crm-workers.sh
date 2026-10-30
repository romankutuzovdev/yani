#!/bin/bash
# Bundle CRM background workers into .next/standalone/crm-workers
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p .next/standalone/crm-workers
npx --yes esbuild \
  scripts/crm-telegram-worker.ts \
  scripts/crm-email-worker.ts \
  scripts/crm-worker.ts \
  --bundle --platform=node --format=cjs \
  --alias:@=./src \
  --alias:next/server=./scripts/hoster/next-server-stub.js \
  --alias:next/headers=./scripts/hoster/next-headers-stub.js \
  --external:@prisma/client \
  --external:telegram \
  --external:nodemailer \
  --external:imapflow \
  --outdir=.next/standalone/crm-workers
echo "built:"
ls -lh .next/standalone/crm-workers/*.js
# sanity: no next/* requires left
if grep -R "require(\"next/" .next/standalone/crm-workers/*.js >/dev/null 2>&1; then
  echo "WARN: still requires next/*" >&2
  grep -n "require(\"next/" .next/standalone/crm-workers/*.js || true
else
  echo "ok: no next/* requires"
fi
