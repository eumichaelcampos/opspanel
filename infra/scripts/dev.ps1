# Libera portas 3000/3001 se processos antigos ficaram presos (Windows dev)
foreach ($port in 3000, 3001) {
  $connections = netstat -ano | Select-String "LISTENING" | Select-String ":$port\s"
  foreach ($line in $connections) {
    if ($line -match '\s(\d+)\s*$') {
      $procId = $matches[1]
      if ($procId -ne "0") {
        Write-Host "Encerrando PID $procId na porta $port" -ForegroundColor Yellow
        taskkill /PID $procId /F 2>$null | Out-Null
      }
    }
  }
}

# Adiciona Docker CLI ao PATH nesta sessao (Windows)
$dockerBin = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin"
if (Test-Path "$dockerBin\docker.exe") {
  $env:PATH = "$dockerBin;" + $env:PATH
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

Get-Content "$root\.env" | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    Set-Item -Path "env:$($matches[1].Trim())" -Value $matches[2].Trim()
  }
}

Write-Host "==> Docker (Postgres + Redis)" -ForegroundColor Cyan
docker compose -f infra/docker/docker-compose.yml up -d postgres redis

Write-Host "==> Build packages" -ForegroundColor Cyan
npx pnpm@9.15.0 --filter @opspanel/config --filter @opspanel/contracts --filter @opspanel/security --filter @opspanel/database --filter @opspanel/wordops --filter @opspanel/observability build

Write-Host "==> Migrations + seed" -ForegroundColor Cyan
$env:DATABASE_URL = if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "postgresql://opspanel:opspanel@127.0.0.1:5432/opspanel" }
npx pnpm@9.15.0 --filter @opspanel/database migrate:deploy
npx pnpm@9.15.0 db:seed

Write-Host ""
Write-Host "==> Iniciando API + Worker + Web (turbo)" -ForegroundColor Green
npx pnpm@9.15.0 dev
