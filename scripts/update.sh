#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> OpsPanel update"
echo "==> Fetching latest from origin/main..."
git fetch origin main
git pull origin main

echo "==> Installing dependencies..."
export CI=1
NODE_ENV=development
if command -v pnpm >/dev/null 2>&1; then
  NODE_ENV=development pnpm install --frozen-lockfile
elif command -v corepack >/dev/null 2>&1; then
  NODE_ENV=development corepack pnpm install --frozen-lockfile
else
  echo "pnpm not found. Install Node 20+ and enable corepack."
  exit 1
fi

echo "==> Syncing APP_VERSION in .env..."
node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(!fs.existsSync('.env'))process.exit(0);let env=fs.readFileSync('.env','utf8');if(/^APP_VERSION=/m.test(env))env=env.replace(/^APP_VERSION=.*/m,'APP_VERSION='+pkg.version);else env+='\nAPP_VERSION='+pkg.version+'\n';fs.writeFileSync('.env',env);"

echo "==> Generating Prisma client..."
pnpm db:generate

echo "==> Running migrations..."
pnpm --filter @opspanel/database exec prisma migrate deploy

echo "==> Building..."
pnpm build

if command -v pm2 >/dev/null 2>&1; then
  echo "==> Reiniciando PM2..."
  pm2 restart opspanel-api opspanel-worker opspanel-web 2>/dev/null || true
fi

echo ""
echo "==> Update complete."
