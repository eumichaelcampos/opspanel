#!/usr/bin/env bash
# Sobe dependências (Docker) e restaura processos PM2 após reboot.
# Usado pelo systemd (opspanel-boot.service) e por scripts/enable-boot-restart.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${OPSPANEL_COMPOSE_FILE:-$ROOT/infra/docker/docker-compose.yml}"
export NVM_DIR="${NVM_DIR:-/root/.nvm}"

log() { echo "[opspanel-boot] $*"; }

# Node/PM2 via nvm (instalação padrão VPS)
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "ERRO: pm2 não encontrado no PATH"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  log "ERRO: docker não encontrado"
  exit 1
fi

# Garante daemon Docker
systemctl start docker >/dev/null 2>&1 || true

# Aguarda socket Docker (até ~60s)
for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
if ! docker info >/dev/null 2>&1; then
  log "ERRO: Docker não respondeu a tempo"
  exit 1
fi

if [ -f "$COMPOSE_FILE" ]; then
  log "docker compose up -d (postgres/redis)"
  docker compose -f "$COMPOSE_FILE" up -d postgres redis
else
  log "AVISO: compose não encontrado em $COMPOSE_FILE"
fi

# Aguarda Postgres aceitar conexões
log "aguardando Postgres..."
ready=0
for _ in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U opspanel >/dev/null 2>&1; then
    ready=1
    break
  fi
  # fallback se o nome do serviço/container for outro
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p 5432 -U opspanel >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" != "1" ]; then
  log "AVISO: Postgres ainda não saudável; PM2 vai subir mesmo assim (autorestart cuida)"
fi

log "pm2 resurrect"
pm2 resurrect || true

# Se dump vazio / processos ausentes, sobe pelo ecosystem padrão
if ! pm2 jlist 2>/dev/null | grep -q '"name":"opspanel-api"'; then
  ECO="$ROOT/scripts/deploy-vps/ecosystem.config.cjs"
  if [ -f "$ECO" ]; then
    log "pm2 start $ECO"
    pm2 start "$ECO"
    pm2 save
  else
    log "AVISO: ecosystem não encontrado e dump PM2 sem opspanel-api"
  fi
fi

pm2 save >/dev/null 2>&1 || true
log "ok"
pm2 ls || true
