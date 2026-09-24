#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> OpsPanel install (v1.0.0)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm not found. Enabling via corepack..."
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
fi

if [ ! -f .env ]; then
  echo "Copy .env.example to .env and configure secrets first." >&2
  exit 1
fi

echo "==> Installing dependencies"
# .env pode ter NODE_ENV=production; install/build precisam de prisma/typescript (devDeps).
NODE_ENV=development pnpm install --frozen-lockfile 2>/dev/null || NODE_ENV=development pnpm install

echo "==> Generating Prisma client"
NODE_ENV=development pnpm db:generate

echo "==> Running migrations"
NODE_ENV=development pnpm --filter @opspanel/database exec prisma migrate deploy

if [ "${SKIP_SEED:-}" != "1" ]; then
  echo "==> Seeding admin user (set SKIP_SEED=1 to skip)"
  pnpm db:seed
fi

echo "==> Building packages"
NODE_ENV=development pnpm build

echo ""
echo "Done. Start services:"
echo "  pnpm --filter @opspanel/api start"
echo "  pnpm --filter @opspanel/worker start"
echo "  pnpm --filter @opspanel/web start"
echo ""
echo "Or development: pnpm dev"
echo ""
echo "Produção (VPS): após subir com PM2, habilite restart no boot:"
echo "  sudo bash scripts/enable-boot-restart.sh"
