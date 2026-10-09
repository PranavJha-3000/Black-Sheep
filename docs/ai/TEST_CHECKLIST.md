# Test Checklist

Run before any change counts as done.

| # | Command | Expected |
|---|---|---|
| 1 | `npm run typecheck` | exits 0 — runs root tsc (src + packages) AND `tsc -p server` |
| 2 | `npm test` | all pass — currently 84 tests across 7 files (engine tests run from `packages/`) |
| 3 | `npm run lint` | exits 0 (`--max-warnings 0`; `_`-prefixed args are ignored by convention) |
| 4 | `npm run build` | `tsc && vite build` succeeds |
| 5 | `npm run server:dev` (needs DB) | `[world] clock started` + `[server] listening on :3001`; `GET /health` → `{"ok":true}` |
| 6 | `scripts/verify-backend.ps1` (needs Docker+WSL) | PASS verdict: MarketTick rows grow with no client connected |

## Task-specific

### Phase 3 — backend (live-DB, blocked on WSL install: see HANDOVER)
- [ ] `powershell -ExecutionPolicy Bypass -File scripts/verify-backend.ps1 -Seconds 60` → VERDICT: PASS
- [ ] `docker exec black-sheep-pg psql -U postgres -d black_sheep -c '\dt'` → all 7 tables exist
- [ ] `prisma/migrations/` contains the init migration and is committed (migrations in VCS)
- [ ] Joining twice with the same user returns `alreadyJoined: true` (idempotent)
- [ ] Room full (maxPlayers) → 409; unknown code → 404; state without membership → 403
- [ ] State response contains NO other player's positions or cash (aggregate `{nav, netExposure}` only)
- [ ] Without `ANTHROPIC_API_KEY`, rival decisions still appear in `RivalDecisionLog` (rule-based twin)

### Rival / LLM / confrontation (Phases 1-2, client)
- [ ] `npm test` includes `rival.test.ts` + `rivalLLM.test.ts` (packages/engine), `stateMapper.test.ts` (wire → projection), and `rival.integration.test.ts` (seeded store shell)
- [ ] Without `ANTHROPIC_API_KEY`: game still runs; rival reasons with templated rule-based text

### Phase 3 — server-authoritative liquidation + result cards (this turn)
- [ ] `npm run typecheck` / `npm test` (84/84) / `npm run lint` / `npm run build` — all green
- [ ] `npx prisma generate` succeeds after schema change (`Fund.liquidated`, `Fund.peakNav`, `LiquidationLog`)
- [ ] (Needs DB) `docker exec black-sheep-pg psql -U postgres -d black_sheep -c '\dt'` → 8 tables now (added `LiquidationLog`)
- [ ] (Needs DB) crowd a short so a fund breaches maintenance margin → within one tick the server force-closes ALL its positions at market price, sets `Fund.liquidated=true`, and writes a `LiquidationLog` row — with the browser tab CLOSED (proves it's server-authoritative, not client-triggered)
- [ ] (Needs DB) the `LiquidationLog.cause` reads `Excessive concentration in <TKR>` or `Excessive leverage`; `rivalContext` is populated when a recent rival decision was confrontational (e.g. "Liquidated shortly after APEX CAPITAL went short NOVA — directly against your position"), else null
- [ ] (Needs DB) `GET /funds/:id/result-card` → JSON `{fundId,name,startingCapital,peakNav,finalNav,cause,rivalContext,durationTicks,bestSingleTrade,liquidated}`; works for a LIVE (non-liquidated) fund too (`cause: "Still trading"`)
- [ ] (Needs DB) `GET /funds/:id/result-card.png` → `Content-Type: image/png`, 1200×630, dark terminal aesthetic with NAV/cause/PnL; a fund UP 300% renders just as validly as one that blew up
- [ ] (Needs DB) result-card endpoints return data with NO auth token and expose NO positions/cash (firewall holds for unauthenticated viewers)
- [ ] UI: sidebar `FundSummaryPanel` always shows NAV/PnL/positions + SHARE button; clicking SHARE copies `http://localhost:3001/funds/<id>/result-card` to clipboard and flips to "COPIED ✓"
- [ ] UI: on liquidation, `LiquidationScreen` shows the cause, the rival-context line (when present), and a green SHARE RESULT button alongside START AGAIN


### Phase 4 — frontend on the backend (this turn)
- [ ] `npm run typecheck` / `npm test` (84/84) / `npm run lint` / `npm run build` — all green
- [ ] (Needs DB) log in as A + B in two tabs, same room: same market; A's trade moves B's tape within one poll (~2.5s)
- [ ] (Needs DB) close tab with trading phase, reopen later: auto-resumes room, market has moved on; away-summary takeover shows when window is long + notable
- [ ] (Needs DB) `POST /rooms/:code/trade` with a junk order → 400 with the engine rejection string; poll after shows no phantom position
- [ ] State response still contains NO other player's positions or cash (aggregates only — re-verify after trade route)

- [ ] Without `ANTHROPIC_API_KEY`: game still runs; rival reasons with templated rule-based text
- [ ] With a key in `.env`: RivalPanel shows "APEX CAPITAL is reviewing positions..." then a 1–2 sentence LLM thesis
- [ ] `curl -X POST localhost:5173/api/llm` with a junk body → Anthropic-shaped 401/400 passthrough (NOT a Vite 404)
- [ ] Restart mid-decision → no stale rival position resurrection
- [ ] Confrontation: crowd a ticker → rival fades it → red banner + `⚔ APEX` on the row; close position → marker clears


