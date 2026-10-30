#!/bin/bash
# Dump status + recent logs for CRM / Telegram / app. Run on the VPS as root.
set -u
cd /var/www/yani 2>/dev/null || true

echo "======== SERVICES ========"
systemctl is-active yani-app yani-crm-email yani-crm-telegram yani-crm-worker nginx 2>&1 || true

echo "======== LISTEN ========"
ss -lntp | grep -E ':80|:443|:3000' || true

echo "======== LOCAL HTTP ========"
curl -sI http://127.0.0.1:3000/login | head -5 || true
curl -sS http://127.0.0.1:3000/api/v1/agents/by-slug/primary | head -c 220; echo
curl -sS -o /tmp/crm-pb.json -w "playbooks_http=%{http_code}\n" http://127.0.0.1:3000/api/crm/playbooks
head -c 300 /tmp/crm-pb.json; echo

echo "======== DB TELEGRAM / SALES ========"
node -e '
const {DatabaseSync}=require("node:sqlite");
const db=new DatabaseSync("prisma/data/yani.db");
console.log("channels", db.prepare("SELECT type,status,substr(lastError,1,120) e, substr(config,1,160) c FROM CrmChannelConnection").all());
try {
  console.log("org sales", db.prepare("SELECT email,role,salesEnabled,salesPlanName,salesPlaybookLimit,orgAgentId FROM User WHERE role=\"ORG\"").all());
} catch (e) { console.log("org sales query fail", String(e)); }
try {
  console.log("agents", db.prepare("SELECT id,slug,name,enabled,isPrimary FROM Agent LIMIT 10").all());
} catch (e) { console.log("agents fail", String(e)); }
' 2>&1 || true

echo "======== APP LOG (crm/error) ========"
journalctl -u yani-app -n 60 --no-pager 2>/dev/null | tail -60
echo "---- /var/log/yani-app.log ----"
grep -iE 'crm|error|prisma|SQLITE|sales|Unauthorized|Forbidden|TELEGRAM' /var/log/yani-app.log 2>/dev/null | tail -40 || true

echo "======== WORKERS ========"
journalctl -u yani-crm-telegram -n 30 --no-pager 2>/dev/null | tail -30
journalctl -u yani-crm-email -n 20 --no-pager 2>/dev/null | tail -20

echo "======== NGINX ERR ========"
tail -30 /var/log/nginx/error.log 2>/dev/null || true

echo "DONE"
