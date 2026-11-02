# Stage 2: One Persistent Global World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rooms, the lobby and per-room worlds with one persistent, seeded, server-authoritative live world that anyone can observe through a public read-only API. Humans no longer need an account or a fund to watch it.

**Architecture:** `Room` becomes `World`. Every log table keeps a `worldId` foreign key, so Mode B experiment worlds (VISION §10) can be added later without another schema rewrite. Stage 2 runs exactly one world, named `live`. Pure, testable logic moves out of the Prisma-bound `server/world.ts` into a new `server/worldCore.ts`, which has no I/O. A new public route, `GET /world/state`, replaces `/rooms/*`. The client drops auth, lobby and player-vs-rival UI and shows the world's fund.

**Tech Stack:** TypeScript 5.5, Express 4 + Prisma 6 (tsx), React 18 + Vite 5 + Zustand 4, Vitest 2 (jsdom).

**Spec:** `docs/VISION.md`. Relevant sections: §3A (the world runs without humans), §5 (one persistent shared economy; deterministic, testable rules), §6 (agents never mutate state directly), §10 (Mode A live world now, Mode B later; record the seed), §13 (observation interface; public observation is separate from privileged configuration), §14 invariants 1, 2, 3, 5, 7 and 10, and §17 (one logical change per task; every stage builds).

## Global Constraints

- `AGENTS.md` and `docs/ai/` are authoritative. Do not edit `docs/ai/CONSTRAINTS.md`.
- No new dependencies.
- **Approved by this plan:** the schema change (drop `Room`, `RoomStatus`, `Fund.userId`, `Fund.lastSeenAt`, `User.funds`; rename every `roomId` to `worldId`; add `World`), and creating the first migration `prisma/migrations/20261102000000_init/`. No migration has ever been applied (HANDOVER: no DB has existed), so nothing is destroyed.
- **Approved by this plan:** the public route `GET /world/state` (no auth) replaces `POST /rooms`, `POST /rooms/:code/join` and `GET /rooms/:code/state`. `/auth/*` stays on the server, reserved for the future privileged research-lab boundary (§13). The client stops using it.
- The pure engine (`packages/engine/**`) is not modified.
- Agent information isolation stays in `buildDecisionInput` (unchanged). The observer payload may show fund books, because humans observing is the product (§13). It must never include the event scheduler, the RNG state or any unfired event (§8: "Know future scheduled or unfired events").
- LLM calls stay outside the world lock (§14.5). Exactly one in-process writer is used: a single `withWorldLock` chain (§14.3). Multi-process leader election is out of scope; see D-016.
- After every task, all four checks pass: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- Never claim live-DB verification. Postgres is still unavailable on this machine.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes (record in DECISIONS.md, Task 5)

- **D-016 — `World` replaces `Room`, keeping `worldId` everywhere.** The rejected alternative was dropping the FK entirely (as the parked `wip/stage2-global-world` branch did with a singleton `id = 1`). That makes Mode B need a second schema migration. The parked branch is used only as a reference; nothing from it is merged. Its `world.ts` deleted the tick loop and its migration SQL is invalid.
- **D-017 — Observation is public; agent isolation lives in the decision input.** `GET /world/state` needs no auth and shows every fund's book. Agents never read the HTTP API.
- **D-018 — The seed is resolved once and persisted.** On first boot `World.seed` = `WORLD_SEED` env (if it is a valid integer in `[0, 2147483647]`), otherwise `config/game.ts` `WORLD_SEED`. After that, the persisted row wins. A different env value only logs a warning.
- **D-019 — Every fund, AI included, is subject to liquidation.** Previously only human funds could be liquidated. A liquidated fund stops making decisions. `LiquidationLog.rivalContext` is written as `null`, because the player-vs-rival narrative is gone.

## Review Focus

1. **Restart must resume, not reseed.** A restarted server must reload the persisted seed and the latest snapshot. A corrupted snapshot must fail loudly, never silently start a fresh market. → Task 1 tests `resolveWorldSeed` (persisted wins) and `parseWorldSnapshot` (throws on malformed JSON or a missing `market`).
2. **Bad `WORLD_SEED` env values** (`'abc'`, `'-1'`, `'3000000000'`, `''`) must fall back to the config seed, never write `NaN` or overflow `int4`. → Task 1 test.
3. **The observer payload must not leak the future.** No scheduler, RNG state or unfired-event fields may appear in `/world/state`. → Task 1 test on `buildWorldStatePayload`.
4. **A fresh world before its first tick** (zero funds, zero events) must render, not crash. → Task 1 (payload with `funds: []`) and Task 4 (`projectState` with `funds: []`).
5. **A liquidated fund must stay visible** with its cause, must not blank the terminal, and must stop deciding. → Task 1 `shouldFundDecide`, Task 4 projection test, and Task 2 removal of the full-screen `LiquidationScreen`.

---

### Task 0: Branch and baseline

**Files:** none.

- [ ] **Step 1:** `git switch main && git pull && git switch -c feat/stage2-global-world`
- [ ] **Step 2:** Run the 4 checks. Expected: all exit 0, `Tests 82 passed (82)`. If not green, STOP and report.

---

### Task 1: `server/worldCore.ts` — pure world logic plus server tests

**Files:**
- Create: `server/worldCore.ts`, `server/worldCore.test.ts`
- Modify: `vitest.config.ts` (add `'server/**/*.test.ts'` to `include`), `config/game.ts` (add a `// --- World ---` section with `WORLD_SEED = 20_261_102` and `LIVE_WORLD_NAME = 'live'`), `server/world.ts` and `server/rooms.ts` (delete their private copies of the moved helpers and import from `./worldCore`; no behaviour change)

**Interfaces — Produces** (all pure: no prisma, no express, no `process.env`):

```ts
export interface PositionRow { id: number; ticker: string; direction: string; quantity: number; entryPrice: number; entryTimestamp: Date; }
export interface ClosedPositionRow { direction: string; quantity: number; entryPrice: number; exitPrice: number | null; }
export function enginePositionFromRow(row: PositionRow): Position;               // moved verbatim from world.ts
export function engineFundFromRows(cash: number, startingCapital: number, rows: PositionRow[]): Fund; // the world.ts version; rooms.ts duplicate deleted
export function realizedOfClosed(row: ClosedPositionRow): number;                // moved verbatim
export function positionKey(ticker: string, direction: string, entryTimestamp: number): string; // moved verbatim
export const MAX_WORLD_SEED = 2_147_483_647;
export function resolveWorldSeed(persisted: number | null, envValue: string | undefined, fallback: number): { seed: number; envIgnored: boolean };
export function parseWorldSnapshot(json: string): { market: MarketState; scheduler: SchedulerState };
export function shouldFundDecide(tickCount: number, pending: boolean, liquidated: boolean): boolean;
export interface ObservedPosition { id: string; ticker: Ticker; direction: Direction; quantity: number; entryPrice: number; entryTimestamp: number; marginReserved: number; price: number; pnl: number; }
export interface ObservedDecision { action: string; ticker: string | null; reasoning: string; confidence: number | null; fillPrice: number | null; realizedPnL: number | null; tickCountAt: number | null; at: string; }
export interface ObservedFund { id: number; name: string; cash: number; startingCapital: number; nav: number; peakNav: number; grossExposure: number; netExposure: number; liquidated: boolean; liquidationCause: string | null; thinking: boolean; positions: ObservedPosition[]; lastDecision: ObservedDecision | null; }
export interface ObservedEvent { id: number; type: string; ticker: string | null; headline: string; priceImpactPercent: number; tickCountAt: number | null; at: string; }
export interface WorldStatePayload { world: { name: string; seed: number; tickCount: number; timestamp: number }; market: { companies: Record<string, Company> }; funds: ObservedFund[]; flow: Record<string, number>; recentEvents: ObservedEvent[]; }
export interface FundInput { id: number; name: string; cash: number; startingCapital: number; peakNav: number; liquidated: boolean; liquidationCause: string | null; thinking: boolean; openPositions: PositionRow[]; lastDecision: { action: string; ticker: string | null; reasoning: string; confidence: number | null; fillPrice: number | null; realizedPnL: number | null; tickCountAt: number | null; timestamp: Date } | null; }
export interface EventInput { id: number; type: string; ticker: string | null; headline: string; priceImpactPercent: number; tickCountAt: number | null; timestamp: Date; }
export function buildWorldStatePayload(world: { name: string; seed: number }, market: MarketState, funds: FundInput[], events: EventInput[]): WorldStatePayload;
```

Rules the tests pin:
- `resolveWorldSeed`: `persisted !== null` → `{ seed: persisted, envIgnored: envValue !== undefined && envValue !== String(persisted) }`. Otherwise use `envValue` only if it matches `/^\d+$/` and is `<= MAX_WORLD_SEED`; else `fallback`. `envIgnored` is false when nothing was persisted.
- `parseWorldSnapshot` throws `Error('corrupt world snapshot')` on invalid JSON, or when `market.companies` or `scheduler` is missing.
- `shouldFundDecide` = `tickCount > 0 && tickCount % RIVAL_DECISION_TICKS === 0 && !pending && !liquidated`.
- `buildWorldStatePayload`: `nav = Math.max(1, markToMarket(...).nav)`; `grossExposure`/`netExposure` from `getExposure`; `flow[t] = getNetFlow(market, t, 15)`; funds sorted by `id` ascending; `market.companies` copies only `ticker, name, sector, price, previousClose, volatility, beta, rateSensitivity, liquidity` (the field list in today's `/state`); `world.tickCount`/`timestamp` come from `market`.

- [ ] **Step 1: Write the failing tests** in `server/worldCore.test.ts` (use `createInitialMarket()` and `initialScheduler()` from the engine):
  - `resolveWorldSeed(77, '9', 1)` → `{ seed: 77, envIgnored: true }`; `resolveWorldSeed(77, '77', 1)` → `{ seed: 77, envIgnored: false }`; `resolveWorldSeed(null, '42', 1).seed === 42`; for each of `'abc'`, `'-1'`, `'3000000000'`, `''`, `undefined`: `resolveWorldSeed(null, v, 20_261_102).seed === 20_261_102`.
  - `parseWorldSnapshot(JSON.stringify({ market: createInitialMarket(), scheduler: initialScheduler() }))` round-trips `market.tickCount`; `parseWorldSnapshot('{')` and `parseWorldSnapshot('{"scheduler":{}}')` both throw `/corrupt world snapshot/`.
  - `shouldFundDecide(10, false, false) === true`; `(0, false, false)`, `(11, false, false)`, `(10, true, false)` and `(10, false, true)` are all `false`.
  - `buildWorldStatePayload({ name: 'live', seed: 1 }, createInitialMarket(), [], [])` → `funds` equals `[]`, `recentEvents` equals `[]`, and `Object.keys(flow)` equals the 6 tickers.
  - With one fund holding one long NOVA row (quantity 100, entryPrice = market price): `funds[0].nav` is within `1e-6` of `cash + 100 * price`, and `funds[0].positions[0].pnl === 0`.
  - **No future leak:** `JSON.stringify(payload)` does not match `/scheduler|nextFire|rng|seedState|pendingEvent/i`. (`world.seed` is a recorded experiment parameter, not RNG state.) Two funds given in id order `[5, 2]` come out as `[2, 5]`.
- [ ] **Step 2:** `npx vitest run server/worldCore.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `server/worldCore.ts`, add the config constants, and point `world.ts`/`rooms.ts` at the moved helpers. `rooms.ts` `/state` keeps its current response shape this task (it is deleted in Task 3).
- [ ] **Step 4:** `npx vitest run server/worldCore.test.ts` → PASS. Run the 4 checks → green, **82 + new**. Record the exact count in the ledger; later tasks quote it as `N1`.
- [ ] **Step 5: Commit** `feat(server): extract pure world core with seed, snapshot and observer payload rules`

---

### Task 2: Client — remove player-vs-rival UI

There is no player any more, so "you vs the rival" cannot exist. This lands before the re-point so each commit stays green against the current `/rooms` projection.

**Files:**
- Delete: `src/components/HeadToHead.tsx`, `src/components/RivalFund.tsx`, `src/components/ConfrontationBanner.tsx`, `src/components/LiquidationScreen.tsx`
- Modify: `src/components/Terminal.tsx` (drop those imports and mounts; the liquidated early-return goes, so the terminal always renders the world; the row that held HeadToHead next to RivalPanel becomes RivalPanel `col-span-4` + FundSummaryPanel `col-span-8`, or keep the existing sidebar mount for FundSummaryPanel and give RivalPanel `col-span-12` — pick one and note it in the ledger), `src/components/Hero.tsx` (drop `RivalFund`; RiskGauge becomes `col-span-8`), `src/components/PositionRow.tsx` (drop `contested` and the `⚔` tag), `src/components/FundSummaryPanel.tsx` (when `liquidated`, show a red `LIQUIDATED — {liquidationCause}` line under the title), `src/store/gameStore.ts` (drop `confrontation`, `contested`, `dismissConfrontation`, `rivalHistory`, `causeOfDeath`, `liquidationRivalContext`), `src/store/stateMapper.ts` (drop the confrontation block, `contested`, `rivalHistory`, `liquidationRivalContext` from `ProjectionPrev`/`Projection`; drop the `detectConfrontation` import), `src/store/stateMapper.test.ts` (delete the 3 confrontation tests: `fires an opposite confrontation…`, `lets a rival_win escalate…`, `never banners a rejected…`; **deleted with their feature**), `src/store/rival.integration.test.ts` (delete `restart clears confrontation state entirely`)

**Interfaces — Produces:** `ProjectionPrev = { priceHistory; navHistory; rivalDecisionKey }`.

- [ ] **Step 1: Write the failing test** (in `rival.integration.test.ts`):

```ts
it('carries no player-vs-rival state', () => {
  const s = useGameStore.getState() as unknown as Record<string, unknown>;
  for (const k of ['confrontation', 'contested', 'dismissConfrontation', 'rivalHistory', 'liquidationRivalContext']) {
    expect(k in s).toBe(false);
  }
});
```

- [ ] **Step 2:** Run it. Expected: FAIL (`confrontation` is present).
- [ ] **Step 3:** Make the removals.
- [ ] **Step 4: Verify.** `git grep -nE "confrontation|contested|HeadToHead|RivalFund\b|LiquidationScreen|rivalHistory" -- src` → no output, except this test's string list. Run the 4 checks → green, **N1 − 4 + 1**.
- [ ] **Step 5: Commit** `chore(client): remove player-vs-rival UI (no players in the global world)`

---

### Task 3: Server — schema, init migration, global live world, public observer route

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261102000000_init/migration.sql`, `prisma/migrations/migration_lock.toml`
- Create: `server/worldRoutes.ts`
- Modify: `server/world.ts`, `server/index.ts`, `scripts/verify-backend.ps1`, `.env.example` (add commented `# WORLD_SEED=20261102`)
- Delete: `server/rooms.ts`

**Schema (exact):**
- Delete `enum RoomStatus` and `model Room`.
- Add `model World { id Int @id @default(autoincrement()); name String @unique; seed Int; createdAt DateTime @default(now()); funds Fund[]; ticks MarketTick[]; events MarketEventLog[]; decisions RivalDecisionLog[]; liquidations LiquidationLog[] }`.
- In `Fund`, `MarketTick`, `MarketEventLog`, `RivalDecisionLog` and `LiquidationLog`: `roomId`/`room` become `worldId Int` / `world World @relation(fields: [worldId], references: [id], onDelete: Cascade)`, and every `@@index([roomId, timestamp])` becomes `@@index([worldId, timestamp])`.
- `Fund`: delete `userId`, `user`, `lastSeenAt` and `@@unique([roomId, userId])`; add `@@unique([worldId, name])`. `User`: delete `funds Fund[]`.
- Rewrite the stale comments that mention players, result cards or the away summary to describe the observer world.

**Interfaces:**
- Consumes (Task 1): `resolveWorldSeed`, `parseWorldSnapshot`, `shouldFundDecide`, `buildWorldStatePayload`, `engineFundFromRows`, `enginePositionFromRow`, `realizedOfClosed`, `positionKey`, `WORLD_SEED`, `LIVE_WORLD_NAME`.
- Produces: `server/world.ts` exports exactly `ensureLiveWorld(): Promise<World>`, `getLiveWorld(): World | undefined`, `withWorldLock<T>(fn: () => Promise<T>): Promise<T>`, `startWorldLoop(): () => void`. In-memory `World` = `{ worldId; name; seed; market; scheduler; events; rivalFundId; rivalFund; rivalPending; rivalLiquidated }`. `server/worldRoutes.ts` exports `worldRouter` with `GET /state` → `WorldStatePayload`.

- [ ] **Step 1:** Edit the schema. `npx prisma validate` → `The schema at prisma/schema.prisma is valid`.
- [ ] **Step 2: Generate the init migration offline** (no DB needed):

```bash
mkdir -p prisma/migrations/20261102000000_init
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261102000000_init/migration.sql
printf '# Please do not edit this file manually\nprovider = "postgresql"\n' > prisma/migrations/migration_lock.toml
npx prisma generate
```

Expected: the SQL contains `CREATE TABLE "World"`, contains no `"Room"`, and every statement ends with `;`. `npx prisma generate` succeeds. Check the file is UTF-8 without a BOM; if PowerShell redirection was used, rewrite it as UTF-8.
- [ ] **Step 3: Rewrite `server/world.ts`** as the single live world:
  - `ensureLiveWorld`: upsert the `World` row by `LIVE_WORLD_NAME`. On create, the seed comes from `resolveWorldSeed(null, process.env.WORLD_SEED, WORLD_SEED)`. On an existing row, call `resolveWorldSeed(row.seed, process.env.WORLD_SEED, WORLD_SEED)` and `console.warn` when `envIgnored`. Find the world's fund (lowest id) or create `RIVAL_NAME` with `STARTING_CAPITAL`. The latest `MarketTick` for the world goes through `parseWorldSnapshot` (a throw propagates: the tick loop logs it and does not tick). With no snapshot, use `createInitialMarket()` + `initialScheduler()`. Then rebuild the rival as today.
  - `tickWorld`: unchanged sequencing, using `w.seed` where `w.rngSeed` was. `trackPeakNav` and `liquidateFunds` query by `worldId`.
  - `liquidateFunds` (renamed from `liquidatePlayerFunds`): runs for **every** non-liquidated fund in the world and writes `rivalContext: null`. When the liquidated fund is `rivalFundId`, set `w.rivalFund` to the post-liquidation fund and `w.rivalLiquidated = true`. Delete `computeRivalContext` and the `detectConfrontation` import.
  - The decision trigger uses `shouldFundDecide(next.tickCount, w.rivalPending, w.rivalLiquidated)`. `decideRival` is unchanged except that `roomId` becomes `worldId`. The LLM call stays outside `withWorldLock`.
  - `withWorldLock` is one module-level promise chain, with the same `then(fn, fn)` semantics.
  - `startWorldLoop`: the interval calls `ensureLiveWorld()` and then `withWorldLock(() => tickWorld(w))`, with errors logged and never thrown.
- [ ] **Step 4:** Create `server/worldRoutes.ts`: `worldRouter.get('/state', wrap(...))` with no auth. It loads the world, funds, open positions, each fund's latest `RivalDecisionLog` and latest `LiquidationLog.cause` (only when liquidated), and the last 10 events. It sets `thinking = w.rivalPending && fund.id === w.rivalFundId` and returns `buildWorldStatePayload(...)`. In `server/index.ts`, mount `app.use('/world', worldRouter)`, delete the rooms import and mount, and `git rm server/rooms.ts`.
- [ ] **Step 5:** Rewrite `scripts/verify-backend.ps1` steps 4–5 (register, rooms, join) as: `GET $Base/world/state` must return `world.name -eq 'live'` and `funds.Count -ge 1`. The psql count, sleep and recount stay. The final state check reads `/world/state` and prints `tickCount` and `funds[0].nav`. Update the header comment.
- [ ] **Step 6: Verify.** `git grep -nE "roomId|Room\b|/rooms|ensureWorld\(|userId" -- server prisma/schema.prisma scripts` → no output, except `auth.ts`'s JWT `userId` (the auth module is unchanged). Run the 4 checks → green, test count unchanged from Task 2. Boot smoke: `npx tsx server/index.ts` → `[server] listening on http://localhost:3001` and `GET /health` → `{"ok":true}` (the world loop logs DB errors without Postgres, which is expected). Stop the server.
- [ ] **Step 7: Commit** `feat(server): one persistent live world with public observer API and init migration`

At this point the client still polls `/rooms/:code/state` and gets a runtime 404. The tree is typecheck- and build-green. Task 4 restores runtime behaviour. Do not stop between Tasks 3 and 4.

---

### Task 4: Client — observe the live world (no auth, no lobby)

**Files:**
- Delete: `src/screens/AuthScreen.tsx`, `src/screens/LobbyScreen.tsx`
- Modify: `src/App.tsx` (render `<Terminal />` only), `src/store/api.ts` (delete `SessionPayload`; `apiFetch` keeps its signature), `src/store/stateMapper.ts`, `src/store/stateMapper.test.ts`, `src/store/gameStore.ts`, `src/store/rival.integration.test.ts`, `src/components/RivalPanel.tsx` (read `nav` instead of `rivalNav`; name from `name` instead of `RIVAL_NAME`; heading `FUND INTEL`)

**Interfaces:**
- Consumes: the `WorldStatePayload` type from `server/worldCore.ts`. `stateMapper.ts` imports it as `import type { WorldStatePayload } from '../../server/worldCore'`, a type-only import, so nothing server-side is bundled. This replaces the hand-written `ApiRoomState` mirror, so the wire contract cannot drift.
- Produces: `projectState(raw: WorldStatePayload, prev: ProjectionPrev): Projection`, where the focus fund is `raw.funds[0]` (lowest id). `gameStore` state no longer has `phase`, `token`, `user`, `roomCode`, `error`, `login`, `logout`, `register`, `clearError`, `setError`, `createRoom`, `joinRoom`, `enterRoom`, `leaveRoom`, `rivalNav`, or the session `localStorage` helpers. `restart` is renamed `reset(): void` (reset the projection to the seed state). `poll()` calls `apiFetch<WorldStatePayload>('/world/state')` with no token and always runs (no phase gate).

- [ ] **Step 1: Write the failing tests.**
  - `stateMapper.test.ts`: rewrite the two surviving tests to feed real payloads from `buildWorldStatePayload(...)` (import from `../../server/worldCore`) instead of hand-written JSON. Add:
    - `it('projects an empty world (no funds yet) without crashing')`: `projectState(buildWorldStatePayload({name:'live',seed:1}, createInitialMarket(), [], []), EMPTY_PREV)` → `fundId === null`, `nav === STARTING_CAPITAL`, `fund.positions` equals `[]`, `rivalFund.lastDecision === null`.
    - `it('surfaces a liquidated focus fund with its cause')`: one fund with `liquidated: true, liquidationCause: 'Excessive leverage'` → `liquidated === true`, `liquidationCause === 'Excessive leverage'`.
    - `it('focuses the lowest-id fund and maps its last decision')`: funds with ids `[3, 9]`, fund 3 with `lastDecision.reasoning === 'fade NOVA'` → `fundId === 3`, `rivalFund.lastDecision?.reasoning === 'fade NOVA'`, `rivalThinking` equals fund 3's `thinking`.
  - `rival.integration.test.ts`: replace the auth-shaped tests (`seeds an offline…` asserting `phase === 'auth'`, and the legacy-session test) with `it('is an observer store: no auth, session or lobby state')`, which asserts each of `phase, token, user, roomCode, login, register, createRoom, joinRoom, logout` is absent, and `it('reset() restores the seed projection')`, which asserts `nav === STARTING_CAPITAL`, `fundId === null` and `events` equals `[]`. Keep the trading and away absence tests.
- [ ] **Step 2:** `npx vitest run src/store` → FAIL (`projectState` still reads `raw.me`; the store still has `phase`).
- [ ] **Step 3:** Implement `projectState` on `WorldStatePayload`. With `funds: []`, project a seed fund: `fundId: null`, `name: ''`, cash = `startingCapital` = `STARTING_CAPITAL`, `rivalFund.lastDecision: null`. Strip the store and `App.tsx`, delete the two screens, and update `RivalPanel`. `Projection.fundId` becomes `number | null`.
- [ ] **Step 4: Verify.** `npx vitest run src/store` → PASS. `git grep -nE "/rooms|roomCode|AuthScreen|LobbyScreen|s\.phase|phase:|apiFetch\('/auth" -- src` → no output, except the absence-test string list in `rival.integration.test.ts`. (History comments that say "Phase 4" are fine.) Run the 4 checks → green. Record the count as `N4`.
- [ ] **Step 5: Client smoke.** Start `npm run dev` and open `http://localhost:5173` in the browser pane. Expected: the terminal renders immediately with no login screen, there are no uncaught errors, and the console shows the `/world/state` request failing (no server or DB). Record that the terminal stayed mounted. Stop the dev server.
- [ ] **Step 6: Commit** `feat(client): observe the live world via public /world/state; drop auth and lobby`

---

### Task 5: Docs, decisions, handover

**Files:** `docs/ai/ARCHITECTURE.md` (modules table: `server/world.ts` single live world, `server/worldCore.ts` pure, `server/worldRoutes.ts` public; drop `server/rooms.ts`; schema row lists `World`; boundaries: observation public, agent firewall in `buildDecisionInput`), `docs/ai/FLOW.md` (world tick: `ensureLiveWorld` and seed resolution, `liquidateFunds` for all funds, `shouldFundDecide`; replace "Room lifecycle" with "Observer state (`GET /world/state`)"), `docs/ai/DECISIONS.md` (add D-016…D-019 as written above, each with Context, Reasoning, Rejected, Tradeoff accepted, Revisit if), `docs/ai/TEST_CHECKLIST.md` (count `N4`; replace the room/join/firewall live-DB rows with: `/world/state` returns `world.name='live'` with no token; the seed persists across a restart with a different `WORLD_SEED` env, which logs a warning; a liquidated fund stops logging decisions), `docs/ai/ROLLBACK.md` (Stage 2 entry: safe commit = the `main` SHA from Task 0; revert = `git switch main` or `git revert`; the DB is non-destructive because no DB has existed; if one was created from this migration, `docker compose down -v` resets it, which destroys data), `docs/ai/HANDOVER.md` (Current state, Open items: remove the Stage 2 item; add "delete parked branch `wip/stage2-global-world` (user decision)", "multi-process writer: advisory-lock leader election (D-016 revisit)", "`detectConfrontation` now has no app caller; reuse it for relationship memory in Stage 3 or remove it"; add a log entry using CHANGED / WHY / VERIFY / NOT VERIFIED), `docs/ai/features/FEATURE-006-global-world.md` (new, from the template)

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** Run the 4 checks → green, `N4` tests. `git diff --stat main...HEAD` lists only files named in Tasks 1–5.
- [ ] **Step 3: Commit** `docs: Stage 2 global world — D-016..D-019, handover`. Do not merge or push.
