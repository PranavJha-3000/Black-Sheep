# scripts/verify-backend.ps1
#
# The backend acceptance test, in one command: boot the server, confirm the
# public observer API serves the live world, then walk away and prove
# MarketTick rows ACCUMULATE with nobody watching. Run only after Docker Desktop is up with a WSL distro installed:
#
#   powershell -ExecutionPolicy Bypass -File scripts/verify-backend.ps1 -Seconds 60
#
param([int]$Seconds = 60)
$ErrorActionPreference = 'Stop'
$Base = 'http://localhost:3001'

Write-Host '== 1. Postgres up =='
docker compose up -d | Out-Null
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  $st = docker inspect --format '{{.State.Health.Status}}' black-sheep-pg 2>$null
  if ($st -eq 'healthy') { $healthy = $true; break }
}
if (-not $healthy) { throw 'Postgres container never became healthy.' }
Write-Host '   Postgres healthy.'

Write-Host '== 2. Apply migrations (tracked in prisma/migrations) =='
npx prisma migrate dev --name init
if ($LASTEXITCODE -ne 0) { throw 'prisma migrate dev failed.' }

Write-Host '== 3. Game server up =='
$out = Join-Path $env:TEMP 'bs-server.log'
$err = Join-Path $env:TEMP 'bs-server.err.log'
$proc = Start-Process 'npx.cmd' -ArgumentList 'tsx', 'server/index.ts' -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $out -RedirectStandardError $err
try {
  $ready = $false
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try { $r = Invoke-WebRequest "$Base/health" -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch {}
  }
  if (-not $ready) { throw "Server did not come up. See $err" }
  Write-Host '   Server healthy on :3001.'

  Write-Host '== 4. Live world is observable (no account needed) =='
  $state0 = Invoke-RestMethod -Uri "$Base/world/state"
  if ($state0.world.name -ne 'live') { throw "FAILED: expected world 'live', got '$($state0.world.name)'." }
  if ($state0.funds.Count -lt 1) { throw 'FAILED: live world has no funds.' }
  Write-Host "   world: $($state0.world.name), seed: $($state0.world.seed), funds: $($state0.funds.Count)"

  $countRows = {
    docker exec black-sheep-pg psql -U postgres -d black_sheep -t -A -c `
      "SELECT 'ticks=' || (SELECT COUNT(*) FROM ""MarketTick"") || ' events=' || (SELECT COUNT(*) FROM ""MarketEventLog"") || ' rival_decisions=' || (SELECT COUNT(*) FROM ""RivalDecisionLog"");"
  }

  Write-Host '== 5. Row count at T0 =='
  $t0 = & $countRows
  Write-Host "   $t0"

  Write-Host "== 6. Walking away for $Seconds seconds (NO client connected) =="
  Start-Sleep -Seconds $Seconds

  Write-Host '== 7. Row count at T1 — rows MUST have grown on their own =='
  $t1 = & $countRows
  Write-Host "   $t1"
  if ($t1 -eq $t0) { throw "FAILED: no new MarketTick rows while unattended. ($t0 -> $t1)" }

  Write-Host '== 8. Observer state =='
  $state = Invoke-RestMethod -Uri "$Base/world/state"
  Write-Host "   tickCount: $($state.world.tickCount)"
  Write-Host "   funds[0].nav: $([math]::Round($state.funds[0].nav))"
  Write-Host "   funds: $($state.funds | ForEach-Object { "$($_.name)=$([math]::Round($_.nav))" })"

  $ticks1 = [int]([regex]::Match($t1, 'ticks=(\d+)').Groups[1].Value)
  $decisions = [int]([regex]::Match($t1, 'rival_decisions=(\d+)').Groups[1].Value)
  Write-Host ''
  Write-Host "VERDICT: PASS - world ticked unattended ($ticks1 MarketTick rows)."
  if ($decisions -eq 0) { Write-Host 'NOTE: no rival decision yet (first one fires at engine tick 10 = ~50s). Run with -Seconds 90 to see one.' }
} finally {
  taskkill /PID $proc.Id /T /F 2>&1 | Out-Null
}
