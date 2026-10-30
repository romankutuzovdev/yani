#!/bin/bash
# Enable HTTPS for yani.by on the VPS (nginx + Let's Encrypt).
# Run as root:
#   bash scripts/vps/setup-https.sh
set -eu

DOMAIN="${DOMAIN:-yani.by}"
WWW="www.${DOMAIN}"
APP_ROOT="${APP_ROOT:-/var/www/yani}"
NGINX_SRC="${NGINX_SRC:-$APP_ROOT/scripts/vps/nginx-yani.conf}"
EMAIL="${CERTBOT_EMAIL:-admin@${DOMAIN}}"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null

mkdir -p /var/www/certbot
# Temporary HTTP-only vhost so certbot can obtain the cert
cat >/etc/nginx/sites-available/yani <<EOF
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name ${DOMAIN} ${WWW};

  location ^~ /.well-known/acme-challenge/ {
    root /var/www/certbot;
    default_type "text/plain";
  }

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
  }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/yani /etc/nginx/sites-enabled/yani
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Obtain / renew certificate (nginx plugin will add ssl server block)
certbot --nginx -d "$DOMAIN" -d "$WWW" \
  --non-interactive --agree-tos -m "$EMAIL" \
  --redirect || {
  echo "certbot failed — check DNS A records for ${DOMAIN}/${WWW} → this server and that :80 is reachable" >&2
  exit 1
}

# Prefer our full config if present (keeps proxy headers / SSE)
if [ -f "$NGINX_SRC" ]; then
  cp -a "$NGINX_SRC" /etc/nginx/sites-available/yani
  # Ensure ssl options exist
  [ -f /etc/letsencrypt/options-ssl-nginx.conf ] || \
    curl -fsSL https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
      -o /etc/letsencrypt/options-ssl-nginx.conf
  [ -f /etc/letsencrypt/ssl-dhparams.pem ] || openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
  nginx -t && systemctl reload nginx
fi

# Point app at HTTPS
if [ -f "$APP_ROOT/.env" ]; then
  if grep -q '^NEXT_PUBLIC_APP_URL=' "$APP_ROOT/.env"; then
    sed -i "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=https://${DOMAIN}|" "$APP_ROOT/.env"
  else
    echo "NEXT_PUBLIC_APP_URL=https://${DOMAIN}" >>"$APP_ROOT/.env"
  fi
  systemctl restart yani-app 2>/dev/null || true
fi

# Open ports if ufw is active (cloud firewall must also allow 80/443)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo "=== check ==="
ss -lntp | grep -E ':80|:443' || true
curl -sI "http://${DOMAIN}/login" | head -5
curl -sI "https://${DOMAIN}/login" | head -5
echo "OK: https://${DOMAIN}"
