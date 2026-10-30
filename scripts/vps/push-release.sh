#!/bin/bash
# Deploy yani-release.tgz to production VPS (yani.by → 178.172.138.152)
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST="${VPS_HOST:-root@178.172.138.152}"
REL="${REL:-$ROOT/yani-release.tgz}"
APPLY="$ROOT/scripts/vps/apply-release.sh"

if [ ! -f "$REL" ]; then
  echo "missing $REL — build first" >&2
  exit 1
fi
if [ ! -f "$APPLY" ]; then
  echo "missing $APPLY" >&2
  exit 1
fi

echo "Upload $(du -h "$REL" | awk '{print $1}') → $HOST"
rsync -avz --partial --inplace --progress "$REL" "$HOST:/root/yani-release.tgz"
rsync -avz --progress "$APPLY" "$HOST:/root/apply-release.sh"
echo "Apply…"
ssh "$HOST" 'bash /root/apply-release.sh'
echo "Check…"
ssh "$HOST" 'curl -s -o /dev/null -w "local_login=%{http_code} t=%{time_total}\n" -m 10 http://127.0.0.1:3000/login; curl -s -o /dev/null -w "local_boot=%{http_code} t=%{time_total}\n" -m 10 http://127.0.0.1:3000/api/crm/bootstrap; systemctl is-active yani-app || true'
echo OK
