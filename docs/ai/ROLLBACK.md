# Rollback

### D-010 · 2026-09-13 · Claude (Cline)
**Decision:** Phase 4 keeps the Phase-2 component tree byte-identical and swaps only the data layer: the store becomes a session + poll projection (`GET /rooms/:code/state` every ~2.5s), trades go through a new `POST /rooms/:code/trade` route with optimistic local fills reconciled by the next poll, and a new `RivalDecisionLog.{confidence,fillPrice,realizedPnL,tickCountAt}` telemetry trio (server persists, `/state` relays, client maps) preserves confrontation detection across the wire.
**Context:** The prompt demanded every component keep working "exactly as before" — a plumbing swap, not a redesign — while the missing trade route and the rival-telemetry gap in `/state` had to be closed on the server first.
**Reasoning:** zustand helpers moved to module scope (they capture `set`/`get` as args) so the creator returns one plain object literal — the earlier split-creator form is what produced the missing-field type error; `withWorldLock` serializes trade-vs-tick writes so no price impact is clobbered; optimistic fills use the same shared-engine functions so a rejected local fill and a rejected server fill agree.
**Rejected:** Keeping a local tick loop as fallback (two sources of truth); websockets (explicitly deferred per prompt — polling is fine for 2–4 players, upgrade path noted in Terminal.tsx).
**Tradeoff accepted:** A trade can appear twice (optimistic then authoritative) for one poll cycle; fill prices may differ by a tick of drift — the poll always wins.
**Revisit if:** Latency complaints → websocket push from `server/world.ts`; server-side player liquidation (still client-dormant `liquidated: false`).

## Phase 4: frontend rewired to the backend · 2026-09-13
Safe commit: `<sha>` (uncommitted — Phase 4 sits in the working tree atop Phase 3)
Revert with:
```
git checkout HEAD -- src/store/gameStore.ts src/App.tsx src/components/Terminal.tsx src/store/rival.integration.test.ts
Remove-Item -Recurse -Force src/screens, src/store/api.ts, src/store/derive.ts, src/store/stateMapper.ts, src/store/stateMapper.test.ts, src/components/AwaySummary.tsx -ErrorAction SilentlyContinue
git checkout HEAD -- server prisma
```
Files touched: `src/store/gameStore.ts` (rewrite: session + poll + optimistic trades + away), `src/store/{api,derive,stateMapper}.ts` + `src/screens/{AuthScreen,LobbyScreen}.tsx` (new), `src/App.tsx` (phase router + away overlay), `src/components/Terminal.tsx` (poll loop + banner/panels already present), `src/components/AwaySummary.tsx` (new), `src/store/{stateMapper,rival.integration}.test.ts` (5 new + 2 rewritten), `server/{rooms,world,index,away,awayUtil}.ts` (trade route, enriched state, lock, CORS, away route), `prisma/schema.prisma` (lastSeenAt + 4 nullable telemetry cols)
Non-code changes to undo: none (no new infra; migration still ungenerated — live-DB step unchanged)
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`

## Phase 3: backend foundation (monorepo + Express + Prisma) · 2026-09-12
Safe commit: `<sha>` (uncommitted — Phase 3 is in the working tree alongside Phases 1-2)
Revert with:
```
git checkout HEAD -- src packages/engine/src package.json package-lock.json tsconfig.json vitest.config.ts .eslintrc.cjs vite.config.ts
Remove-Item -Recurse -Force server, prisma, scripts, packages -ErrorAction SilentlyContinue
Remove-Item docker-compose.yml, .env.example -ErrorAction SilentlyContinue
npm install
```
NOTE: `src/engine` no longer exists at HEAD in this tree's history — if `git checkout HEAD -- src` restores a pre-Phase-1 `src/engine`, Phases 1-2 also roll back. To keep Phases 1-2 but drop Phase 3, restore `src` to its Phase-2 state only (client imports `../engine/*` paths), i.e. revert the 15 import-site edits + `package.json` workspaces, and re-create `src/engine` from `packages/engine/src` (file-for-file copy; zero content changes were made to engine files other than two additive exports).
Files touched (Phase 3 only): `packages/**` (moved engine + package.json), `src/store/gameStore.ts` + 3 components + `src/engine.test.ts` + `src/store/rival.integration.test.ts` (import paths only), `package.json` (workspaces, scripts, deps), `server/*` (5 files, new), `prisma/schema.prisma` (new), `docker-compose.yml` (new), `scripts/verify-backend.ps1` (new), `.env` / `.env.example` (DATABASE_URL, JWT_SECRET), `vitest.config.ts`, `tsconfig.json`, `.eslintrc.cjs`
Non-code changes to undo: Postgres container (`docker compose down -v` removes the volume — destructive to game data); `node_modules` re-install after workspace removal
Re-check after rollback: `npx tsc --noEmit`; `npm test`; `npm run lint`; `npm run build`; `curl localhost:5173/api/llm` passthrough still 401/400 (Vite plugin untouched)

## Phase 2: confrontation UI (Billions moments) · 2026-09-12
Safe commit: `<sha>` (uncommitted)
Revert with: `git checkout HEAD -- src/engine/rival.ts src/engine/rival.test.ts src/store/gameStore.ts src/store/rival.integration.test.ts src/components/PositionRow.tsx src/components/Terminal.tsx && rm src/components/HeadToHead.tsx src/components/ConfrontationBanner.tsx`
Files touched: engine rival.ts (detectConfrontation, telemetry), gameStore (confrontation/contested state), PositionRow (⚔ APEX), Terminal (banner + HeadToHead), + 2 new components
Non-code changes to undo: docs/ai references (informational)
Re-check after rollback: tsc/test/lint/build; no `contested`/`confrontation` refs remain in gameStore
Note: engine paths in this entry predate the Phase 3 move — after Phase 3 the equivalents live in `packages/engine/src/*`.
