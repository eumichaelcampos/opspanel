# Adiciona Docker CLI ao PATH nesta sessão (Windows)
$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
if (Test-Path "$dockerBin\docker.exe") {
  $env:PATH = "$dockerBin;" + $env:PATH
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

# Carrega .env
Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim()
  }
}

Write-Host "==> Docker (Postgres + Redis)" -ForegroundColor Cyan
docker compose -f infra/docker/docker-compose.yml up -d postgres redis

Write-Host "==> Migrations + seed" -ForegroundColor Cyan
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql://opspanel:opspanel@127.0.0.1:5432/opspanel" }
npx pnpm@9.15.0 --filter @opspanel/database migrate:deploy
npx pnpm@9.15.0 db:seed

Write-Host ""
Write-Host "Stack pronta. Rode tudo de uma vez:" -ForegroundColor Green
Write-Host "  powershell -File infra/scripts/dev.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "Ou abra 3 terminais:" -ForegroundColor Green
Write-Host "  npx pnpm@9.15.0 --filter @opspanel/api dev"
Write-Host "  npx pnpm@9.15.0 --filter @opspanel/worker dev"
Write-Host "  npx pnpm@9.15.0 --filter @opspanel/web dev"
Write-Host ""
Write-Host "Web:    http://localhost:3000/login"
Write-Host "Login:  admin@localhost / ChangeMe123!"
