#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> OpsPanel update"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is required for updates."
}

Write-Host "==> Fetching latest from origin/main..."
git fetch origin main
git pull origin main

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) {
    corepack enable | Out-Null
    corepack prepare pnpm@9.15.0 --activate | Out-Null
  } else {
    throw "pnpm not found. Install Node 20+ and enable corepack."
  }
}

Write-Host "==> Installing dependencies..."
$env:CI = "1"
corepack pnpm install --frozen-lockfile --prod=false

Write-Host "==> Syncing APP_VERSION in .env..."
node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(!fs.existsSync('.env'))process.exit(0);let env=fs.readFileSync('.env','utf8');if(/^APP_VERSION=/m.test(env))env=env.replace(/^APP_VERSION=.*/m,'APP_VERSION='+pkg.version);else env+='\nAPP_VERSION='+pkg.version+'\n';fs.writeFileSync('.env',env);"

Write-Host "==> Generating Prisma client..."
corepack pnpm db:generate

Write-Host "==> Running migrations..."
corepack pnpm --filter @opspanel/database exec prisma migrate deploy

Write-Host "==> Building..."
corepack pnpm build

if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  Write-Host "==> Reiniciando PM2..."
  pm2 restart opspanel-api opspanel-worker opspanel-web 2>$null
}

Write-Host ""
Write-Host "==> Update complete."
