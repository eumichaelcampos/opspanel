#!/usr/bin/env bash
# Instala OpsPanel client em VPS Ubuntu (WordOps). Rode como root após upload do código.
set -euo pipefail

OPSPANEL_DIR="${OPSPANEL_DIR:-/root/opspanel}"

# IP público do servidor deste cliente (nunca embutir IP de outro ambiente no repo).
if [ -z "${HOST_IP:-}" ]; then
  HOST_IP="$(curl -4 -fsS --max-time 5 ifconfig.me 2>/dev/null || true)"
fi
if [ -z "${HOST_IP:-}" ]; then
  HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "${HOST_IP:-}" ]; then
  echo "ERRO: defina HOST_IP=IP.PUBLICO.DO.SERVIDOR" >&2
  exit 1
fi

WEB_URL="${WEB_URL:-http://${HOST_IP}:3000}"
API_URL="${API_URL:-http://${HOST_IP}:3001}"

echo "==> OpsPanel client install em ${OPSPANEL_DIR} (HOST_IP=${HOST_IP})"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

export NVM_DIR="/root/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
corepack enable
corepack prepare pnpm@9.15.0 --activate
npm install -g pm2

mkdir -p "$OPSPANEL_DIR"
cd "$OPSPANEL_DIR"

if [ ! -f package.json ]; then
  echo "ERRO: package.json não encontrado em $OPSPANEL_DIR" >&2
  exit 1
fi

: "${SESSION_SECRET:?SESSION_SECRET obrigatório}"
: "${CREDENTIALS_ENCRYPTION_KEY:?CREDENTIALS_ENCRYPTION_KEY obrigatório}"
: "${LICENSE_KEY:?LICENSE_KEY obrigatório}"
: "${LICENSE_SIGNING_SECRET:?LICENSE_SIGNING_SECRET obrigatório}"
: "${LICENSE_REGISTER_SECRET:?LICENSE_REGISTER_SECRET obrigatório}"

cat > .env <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://opspanel:opspanel@127.0.0.1:5432/opspanel
REDIS_URL=redis://127.0.0.1:6379
API_PORT=3001
API_URL=${API_URL}
WEB_URL=${WEB_URL}
SESSION_SECRET=${SESSION_SECRET}
CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}
SKIP_SEED=1
LICENSE_SERVER_URL=https://license.michaelcampos.com.br
GOOGLE_OAUTH_BROKER_URL=https://publisher.michaelcampos.com.br/v1
LICENSE_REGISTER_SECRET=${LICENSE_REGISTER_SECRET}
LICENSE_SIGNING_SECRET=${LICENSE_SIGNING_SECRET}
LICENSE_KEY=${LICENSE_KEY}
LICENSE_PLAN=free
APP_VERSION=1.0.0
UPDATE_GITHUB_REPO=eumichaelcampos/opspanel
EOF

mkdir -p apps/web
echo "API_URL=${API_URL}" > apps/web/.env.local
echo "NEXT_PUBLIC_GITHUB_REPO=eumichaelcampos/opspanel" >> apps/web/.env.local

echo "==> Postgres + Redis (Docker)"
# Em VPS, bind só em localhost
sed -i 's/"5432:5432"/"127.0.0.1:5432:5432"/' infra/docker/docker-compose.yml || true
sed -i 's/"6379:6379"/"127.0.0.1:6379:6379"/' infra/docker/docker-compose.yml || true
docker compose -f infra/docker/docker-compose.yml up -d postgres redis
sleep 8

echo "==> Build OpsPanel (banco vazio; setup cria a empresa do cliente)"
find . -name '*.sh' -exec sed -i 's/\r$//' {} +
set -a
# shellcheck disable=SC1091
source ./.env
set +a
# Nunca semeia admin/servidores de outro cliente no install de produção
export SKIP_SEED=1
bash scripts/install.sh

echo "==> PM2"
pm2 delete opspanel-api opspanel-worker opspanel-web 2>/dev/null || true
pm2 start scripts/deploy-vps/ecosystem.config.cjs
pm2 save

echo "==> Boot restart (Docker + PM2 sobrevivem a reboot)"
chmod +x scripts/opspanel-boot.sh scripts/enable-boot-restart.sh
bash scripts/enable-boot-restart.sh

echo "==> Firewall (3000/3001)"
ufw allow 3000/tcp 2>/dev/null || true
ufw allow 3001/tcp 2>/dev/null || true

echo ""
echo "==> OpsPanel client OK"
echo "  Painel: ${WEB_URL}/setup"
echo "  API:    ${API_URL}/api/v1/health"
curl -sf "${API_URL}/api/v1/health" || echo "(aguarde alguns segundos e teste de novo)"
