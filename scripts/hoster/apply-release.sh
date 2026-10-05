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
