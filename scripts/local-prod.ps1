# TaskFlow Pro — start Postgres + Redis, then migrate (backend .env must be configured).
# Run from repo root:  powershell -ExecutionPolicy Bypass -File .\scripts\local-prod.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "Starting Postgres and Redis (Docker)..."
docker compose up -d postgres redis

Write-Host "Waiting for Postgres health..."
$deadline = (Get-Date).AddMinutes(2)
while ((Get-Date) -lt $deadline) {
  docker compose exec -T postgres pg_isready -U taskflow 2>$null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}

Push-Location (Join-Path $Root "backend")
if (-not (Test-Path ".env")) {
  Write-Host "Create backend\.env from backend\.env.example (DATABASE_URL, REDIS_URL, JWT_*, DATABASE_SSL=false for Docker Postgres)."
  Pop-Location
  exit 1
}
Write-Host "Running migrations..."
npm run migrate
Pop-Location

Write-Host @"

Next steps:
  1) Backend:  cd backend; npm start   (set NODE_ENV=production in .env when you want prod mode)
  2) Frontend: cd frontend; npm run build; npm run preview:prod
  3) Open http://localhost:5174  — CLIENT_ORIGIN in backend .env must include this origin.

"@
