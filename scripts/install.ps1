#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> OpsPanel install (v1.0.0)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required."
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "Enabling pnpm via corepack..."
  corepack enable
  corepack prepare pnpm@9.15.0 --activate
}

if (-not (Test-Path ".env")) {
  throw "Copy .env.example to .env and configure secrets first."
}

Write-Host "==> Installing dependencies"
corepack pnpm install

Write-Host "==> Generating Prisma client"
corepack pnpm db:generate

Write-Host "==> Running migrations"
corepack pnpm --filter @opspanel/database exec prisma migrate deploy

if ($env:SKIP_SEED -ne "1") {
  Write-Host "==> Seeding admin user (set SKIP_SEED=1 to skip)"
  corepack pnpm db:seed
}

Write-Host "==> Building packages"
corepack pnpm build

Write-Host ""
Write-Host "Done. Start with: corepack pnpm dev"
Write-Host "Or production: api + worker + web start scripts"
