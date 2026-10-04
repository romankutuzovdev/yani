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

# Remember the port the live process is actually using.
LIVE_PORT=""
live_pid="$(ps -u "$(id -u)" -o pid=,args= | awk '/[n]ode server\.js/ {print $1; exit}')"
if [ -n "$live_pid" ] && [ -r "/proc/${live_pid}/environ" ]; then
  LIVE_PORT="$(tr '\0' '\n' < "/proc/${live_pid}/environ" | sed -n 's/^PORT=//p' | head -1)"
fi

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'prisma/data/' \
  --exclude 'uploads/' \
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

if [ -n "$live_pid" ]; then
  kill "$live_pid" 2>/dev/null || true
  sleep 1
fi

set -a
# shellcheck disable=SC1091
. "$APP/.env"
set +a
if [ -n "$LIVE_PORT" ]; then
  export PORT="$LIVE_PORT"
fi
export NODE_ENV=production
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

cd "$APP"
nohup "$NODE" server.js >> "${HOME}/yani-app.log" 2>&1 &
echo $! > "${HOME}/yani.pid"
echo "started pid $(cat "${HOME}/yani.pid") port ${PORT:-3000}"
