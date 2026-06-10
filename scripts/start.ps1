param([switch]$NoTunnel)

Write-Host "=== CANS 4 CASH Server ===" -ForegroundColor Green

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }
}

if (-not $env:DATABASE_URL -and -not (Test-Path ".env")) {
  Write-Host "WARNING: DATABASE_URL not set. Create a .env file or set the environment variable." -ForegroundColor Yellow
}

if ($NoTunnel) { $env:LOCALTONET_TOKEN = "" }

$env:PORT = if ($env:PORT) { $env:PORT } else { "3000" }

Write-Host "Starting server on port $env:PORT ..." -ForegroundColor Cyan
node server.js
