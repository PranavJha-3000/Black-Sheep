# scripts/verify-backend.ps1
#
# The Phase 3 acceptance test, in one command: create a room, join it with two
# users, then walk away and prove MarketTick rows ACCUMULATE with no client
# connected. Run only after Docker Desktop is up with a WSL distro installed:
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

  Write-Host '== 4. Register / login two users =='
  function New-Session([string]$email) {
    $body = (@{ email = $email; password = 'password123' } | ConvertTo-Json)
    try {
      return Invoke-RestMethod -Method Post -Uri "$Base/auth/register" -ContentType 'application/json' -Body $body
    } catch {
      return Invoke-RestMethod -Method Post -Uri "$Base/auth/login" -ContentType 'application/json' -Body $body
    }
  }
  $alice = New-Session 'alice@test.dev'
  $bob = New-Session 'bob@test.dev'
  Write-Host "   alice id=$($alice.user.id), bob id=$($bob.user.id)"

  Write-Host '== 5. Create room + join =='
  $headersA = @{ Authorization = "Bearer $($alice.token)" }
  $headersB = @{ Authorization = "Bearer $($bob.token)" }
  $room = Invoke-RestMethod -Method Post -Uri "$Base/rooms" -Headers $headersA -ContentType 'application/json' -Body '{"maxPlayers":4}'
  $code = $room.room.code
  Write-Host "   room code: $code"
  Invoke-RestMethod -Method Post -Uri "$Base/rooms/$code/join" -Headers $headersA | Out-Null
  Invoke-RestMethod -Method Post -Uri "$Base/rooms/$code/join" -Headers $headersB | Out-Null

  $countRows = {
    docker exec black-sheep-pg psql -U postgres -d black_sheep -t -A -c `
      "SELECT 'ticks=' || (SELECT COUNT(*) FROM ""MarketTick"") || ' events=' || (SELECT COUNT(*) FROM ""MarketEventLog"") || ' rival_decisions=' || (SELECT COUNT(*) FROM ""RivalDecisionLog"");"
  }

  Write-Host '== 6. Row count at T0 =='
  $t0 = & $countRows
  Write-Host "   $t0"

  Write-Host "== 7. Walking away for $Seconds seconds (NO client connected) =="
  Start-Sleep -Seconds $Seconds

  Write-Host '== 8. Row count at T1 — rows MUST have grown on their own =='
  $t1 = & $countRows
  Write-Host "   $t1"
  if ($t1 -eq $t0) { throw "FAILED: no new MarketTick rows while unattended. ($t0 -> $t1)" }

  Write-Host '== 9. State endpoint (alice) =='
  $state = Invoke-RestMethod -Uri "$Base/rooms/$code/state" -Headers $headersA
  Write-Host "   tickCount: $($state.room.tickCount)"
  Write-Host "   funds: $($state.funds | ForEach-Object { "$($_.name)=$([math]::Round($_.nav))" })"
  Write-Host "   rival lastDecision: $($state.rival.lastDecision | ConvertTo-Json -Compress)"
  Write-Host "   my positions: $($state.me.positions.Count), cash: $($state.me.cash)"

  $ticks1 = [int]([regex]::Match($t1, 'ticks=(\d+)').Groups[1].Value)
  $decisions = [int]([regex]::Match($t1, 'rival_decisions=(\d+)').Groups[1].Value)
  Write-Host ''
  Write-Host "VERDICT: PASS - world ticked unattended ($ticks1 MarketTick rows)."
  if ($decisions -eq 0) { Write-Host 'NOTE: no rival decision yet (first one fires at engine tick 10 = ~50s). Run with -Seconds 90 to see one.' }
} finally {
  taskkill /PID $proc.Id /T /F 2>&1 | Out-Null
}
