#!/usr/bin/env bash
# Configura Nginx (e opcionalmente SSL) para servir o OpsPanel em um domínio.
# Uso: sudo bash scripts/configure-panel-domain.sh painel.suaempresa.com [--ssl]
set -euo pipefail

DOMAIN="${1:-}"
WANT_SSL="${2:-}"

if [ -z "$DOMAIN" ]; then
  echo "Uso: sudo bash scripts/configure-panel-domain.sh painel.suaempresa.com [--ssl]" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root." >&2
  exit 1
fi

DOMAIN="$(echo "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/.*##; s/\.$//')"
CONF="/etc/nginx/sites-available/opspanel-panel.conf"
ENABLED="/etc/nginx/sites-enabled/opspanel-panel.conf"

if ! command -v nginx >/dev/null 2>&1; then
  echo "Nginx não encontrado. Instale Nginx/WordOps antes." >&2
  exit 1
fi

cat > "$CONF" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  client_max_body_size 64m;

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

ln -sfn "$CONF" "$ENABLED"
nginx -t
systemctl reload nginx

echo "Nginx OK: http://${DOMAIN} → 127.0.0.1:3000"

if [ "$WANT_SSL" = "--ssl" ]; then
  if command -v certbot >/dev/null 2>&1; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || \
      certbot --nginx -d "$DOMAIN"
    echo "SSL OK: https://${DOMAIN}"
  else
    echo "certbot não encontrado. Instale certbot para SSL automático." >&2
  fi
fi

echo ""
echo "Lembre de ter WEB_URL/API_URL=${DOMAIN} no .env e reiniciar:"
echo "  pm2 restart opspanel-api opspanel-web"
