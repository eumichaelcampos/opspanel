#!/usr/bin/env bash
# Configura o host para subir OpsPanel sozinho após reboot:
# Docker (postgres/redis) + PM2 + unidade systemd opspanel-boot.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.yml"
UNIT_SRC="$ROOT/infra/systemd/opspanel-boot.service"
UNIT_DST="/etc/systemd/system/opspanel-boot.service"
BOOT_SCRIPT="$ROOT/scripts/opspanel-boot.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo "Rode como root: sudo bash scripts/enable-boot-restart.sh" >&2
  exit 1
fi

export NVM_DIR="${NVM_DIR:-/root/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || true
fi

echo "==> Enable Docker on boot"
if command -v docker >/dev/null 2>&1; then
  systemctl enable docker >/dev/null 2>&1 || true
  systemctl start docker >/dev/null 2>&1 || true
else
  echo "Docker não encontrado. Instale antes de habilitar boot restart." >&2
  exit 1
fi

echo "==> Docker Compose up + restart policy"
if [ -f "$COMPOSE_FILE" ]; then
  docker compose -f "$COMPOSE_FILE" up -d postgres redis
  # reforça policy mesmo em containers já criados sem restart:
  docker compose -f "$COMPOSE_FILE" ps -q postgres redis 2>/dev/null | while read -r id; do
    [ -n "$id" ] || continue
    docker update --restart unless-stopped "$id" >/dev/null || true
  done
fi

echo "==> PM2 startup (systemd)"
if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 não encontrado (npm i -g pm2)." >&2
  exit 1
fi

# Garante lista salva
if pm2 jlist 2>/dev/null | grep -q '"name":"opspanel-api"'; then
  pm2 save
else
  ECO="$ROOT/scripts/deploy-vps/ecosystem.config.cjs"
  if [ -f "$ECO" ]; then
    pm2 start "$ECO"
    pm2 save
  fi
fi

# Instala unidade pm2-root se ainda não existir
pm2 startup systemd -u root --hp /root >/tmp/opspanel-pm2-startup.txt 2>&1 || true
STARTUP_CMD="$(grep -E '^(sudo )?env .*pm2|^sudo .*systemctl enable|^systemctl enable pm2' /tmp/opspanel-pm2-startup.txt | tail -1 || true)"
if [ -n "${STARTUP_CMD}" ]; then
  # shellcheck disable=SC2086
  eval ${STARTUP_CMD} || true
fi
systemctl enable pm2-root >/dev/null 2>&1 || true

echo "==> Unidade opspanel-boot (Docker primeiro, depois PM2)"
chmod +x "$BOOT_SCRIPT"
# Gera unit com caminho absoluto do script
cat > "$UNIT_DST" <<EOF
[Unit]
Description=OpsPanel boot (Docker deps + PM2)
Documentation=https://github.com/eumichaelcampos/opspanel
After=network-online.target docker.service
Wants=network-online.target docker.service
# Roda depois do pm2-root para poder "consertar" ordem DB→API se necessário
After=pm2-root.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=root
Environment=NVM_DIR=/root/.nvm
Environment=OPSPANEL_COMPOSE_FILE=$COMPOSE_FILE
ExecStart=$BOOT_SCRIPT
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable opspanel-boot.service >/dev/null
# smoke: não derruba se já estiver ok
systemctl start opspanel-boot.service || true

echo ""
echo "Boot restart habilitado:"
echo "  - docker: enable + restart=unless-stopped (postgres/redis)"
echo "  - pm2-root.service"
echo "  - opspanel-boot.service (espera DB e restaura PM2)"
echo ""
echo "Teste sem reboot: systemctl start opspanel-boot.service && pm2 ls"
