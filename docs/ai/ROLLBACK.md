# Rollback

## Stage 4 decision cycle · 2026-11-02
Safe commit: `557fc28` (main). Work lives on branch `feat/stage4-decision-cycle`.
Revert with: `git switch main` (branch unmerged), or after merge `git revert -m 1 <merge commit>`, then `npm install` to drop `@anthropic-ai/sdk`.
Files touched: `config/{game,funds,models}.ts`, `packages/engine/src/{fundTools (new),rivalLLM,policies}.ts` + tests, `server/{budget (new),world,worldCore,worldRoutes}.ts` + tests, `server/providers/anthropic.ts` + test (new), `prisma/schema.prisma`, `prisma/migrations/20261102020000_decision_metering/` (new), `src/store/stateMapper{,.test}.ts`, `src/components/FundsStrip.tsx`, `package.json`, `package-lock.json`, `docs/**`.
Non-code changes to undo: migration `20261102020000_decision_metering` adds tables `LlmCallLog`, `ToolCallLog` and columns `RivalDecisionLog.{source,model,llmCallId}` + an index. It has never been applied (no DB). If applied, reverted code ignores the extra columns/tables (all defaulted or nullable); to drop them: `DROP TABLE "ToolCallLog"; DROP TABLE "LlmCallLog"; ALTER TABLE "RivalDecisionLog" DROP COLUMN "llmCallId", DROP COLUMN "model", DROP COLUMN "source";` and delete the `_prisma_migrations` row — or `docker compose down -v` (DESTROYS all world data). Never edit the applied migration.
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`.

## Stage 3 fund registry · 2026-11-02
Safe commit: `d4936e3` (main). Work lives on branch `feat/stage3-fund-registry`.
Revert with: `git switch main` (branch unmerged), or after merge `git revert -m 1 <merge commit>`.
Files touched: `config/{funds,models}.ts` (new), `config/game.ts`, `packages/engine/src/{funds,policies}.ts` + tests (new), `packages/engine/src/{rivalLLM,rivalLLM.test,market,types}.ts`, `server/{world,worldCore,worldCore.test,worldRoutes}.ts`, `src/components/{FundsStrip (new),Terminal,StockChart}.tsx`, `src/store/{gameStore,stateMapper,stateMapper.test}.ts`, `src/engine.test.ts`, `docs/**`.
Non-code changes to undo: no schema change, no migration. A database that ran this stage holds three extra `Fund` rows (the registry funds) and snapshots with 10 companies; reverted Stage 2 code still loads them: it keeps trading the 10-company snapshot and treats the lowest-id fund as its single rival. To return to a clean 6-company world, `docker compose down -v` (DESTROYS all world data).
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`.

## Stage 2 global live world · 2026-11-02
Safe commit: `cdd1ca7` (main). Work lives on branch `feat/stage2-global-world`.
Revert with: `git switch main` (branch unmerged), or after merge `git revert cdd1ca7..<last Stage 2 commit>`.
Files touched: `server/{worldCore,worldCore.test,worldRoutes}.ts` (new), `server/{world,index}.ts`, `server/rooms.ts` (deleted), `prisma/schema.prisma`, `prisma/migrations/**` (new), `config/game.ts`, `vitest.config.ts`, `scripts/verify-backend.ps1`, `.env.example`, `src/App.tsx`, `src/screens/*` (deleted), `src/components/{HeadToHead,RivalFund,ConfrontationBanner,LiquidationScreen}.tsx` (deleted), `src/components/{Terminal,Hero,PositionRow,FundSummaryPanel,RivalPanel}.tsx`, `src/store/{gameStore,stateMapper,api}.ts` + tests, `docs/ai/*`.
Non-code changes to undo: none so far — no database has ever been created from these migrations. If one was created, `docker compose down -v` resets it (DESTROYS all world data), then `npx prisma generate` on the reverted schema.
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`.

## Stage 1 repo cleanup · 2026-11-02
Safe commit: `da08a4f` (main). Work lives on branch `chore/stage1-cleanup`.
Revert with: `git switch main` (branch unmerged), or after merge `git revert <first>..<last>` over the Stage 1 commits.
Files touched: `docs/VISION.md` (new), `docs/archive/BLACK-SHEEP-DESIGN-DOC.md` (moved), `README.md`, `.clinerules/{code.md (deleted),coding_standard.md}`, `docs/ai/*`, `src/components/{OrderTicket (deleted),AwaySummary (deleted),PositionRow,Terminal,FundSummaryPanel,LiquidationScreen}.tsx`, `src/App.tsx`, `src/store/gameStore.ts`, `src/store/rival.integration.test.ts`, `server/{rooms,index}.ts`, `server/{away,awayUtil,resultCard}.ts` (deleted), `packages/engine/src/{rivalLLM,rivalLLM.test,index}.ts`, `packages/engine/src/{away,away.test}.ts` (deleted), `config/game.ts`, `vite.config.ts`, `package.json`, `package-lock.json`.
Non-code changes to undo: run `npm install` after reverting the result-card commit to restore `@vercel/og`.
Parked WIP: the unfinished Stage 2 global-world edit (previously uncommitted on main) is on branch `wip/stage2-global-world` (`2ab185d`). It does not typecheck and its migration SQL is missing a `;`.
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`.

## Centralize tuning params into config/game.ts · 2026-10-09
Safe commit: uncommitted (working tree).
Revert with: `git checkout HEAD -- config server packages/engine/src src` — pure constant relocation, no data/schema touched.
Files touched: `config/game.ts` (new), `packages/engine/src/{market,portfolio,rival,events,away}.ts`, `server/{world,rooms}.ts`, `src/store/{derive,gameStore}.ts`, `src/components/RivalFund.tsx`.
Non-code changes to undo: `docs/ai/{ROLLBACK,DECISIONS,HANDOVER}.md` entries.
Re-check after rollback: `npm run typecheck`; `npm test`; `npm run lint`; `npm run build`.


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
