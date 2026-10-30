#!/bin/bash
# Install Yani systemd units on the VPS (auto-restart on crash/reboot).
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="${APP_DIR:-/var/www/yani}"

if [ ! -f "$APP/server.js" ]; then
  echo "missing $APP/server.js" >&2
  exit 1
fi

# Stop old nohup processes so ports/workers are free.
fuser -k 3000/tcp 2>/dev/null || true
pkill -f '/var/www/yani/server.js' 2>/dev/null || true
pkill -f 'next-server' 2>/dev/null || true
pkill -f 'crm-email-worker' 2>/dev/null || true
pkill -f 'crm-telegram-worker' 2>/dev/null || true
pkill -f 'crm-workers/crm-worker' 2>/dev/null || true
sleep 1

install -m 644 "$ROOT/yani-app.service" /etc/systemd/system/yani-app.service
install -m 644 "$ROOT/yani-crm-email.service" /etc/systemd/system/yani-crm-email.service
install -m 644 "$ROOT/yani-crm-telegram.service" /etc/systemd/system/yani-crm-telegram.service
install -m 644 "$ROOT/yani-crm-worker.service" /etc/systemd/system/yani-crm-worker.service

systemctl daemon-reload
systemctl enable --now yani-app yani-crm-email yani-crm-telegram yani-crm-worker
systemctl restart yani-app yani-crm-email yani-crm-telegram yani-crm-worker

sleep 2
systemctl --no-pager --full status yani-app yani-crm-email yani-crm-telegram yani-crm-worker || true
curl -sI http://127.0.0.1:3000/login | head -5 || true
echo "OK: services installed with Restart=always"
