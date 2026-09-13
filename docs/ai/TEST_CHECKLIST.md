# Test Checklist

Run before any change counts as done.

| # | Command | Expected |
|---|---|---|
| 1 | `npm run typecheck` | exits 0 — runs root tsc (src + packages) AND `tsc -p server` |
| 2 | `npm test` | all pass — currently 78 tests across 6 files (engine tests run from `packages/`) |
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


