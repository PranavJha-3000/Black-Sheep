# Architecture

## Modules
| Module | Responsibility | Talks to |
|---|---|---|
| `packages/engine` (`@black-sheep/engine`) | THE shared pure engine: market evolution/impact/flow, portfolio lifecycle, events, rival shell + LLM brain. UI-free, imported by client AND server | nothing |
| `config/funds.ts`, `config/models.ts` | Literal-only registries: the AI funds (identity, mandate, strategy, model, risk limit, cadence slot) and the models they may use (pricing, effort). Dependency-free so the engine can import them | nothing |
| `packages/engine/src/memory.ts` | Pure memory rules: episodes, reflections, relationship notes, prompt selection, `recall_memory` filtering | config |
| `packages/engine/src/fundTools.ts` | Pure fund research tools (`FUND_TOOLS`, `runFundTool`) and `submit_decision` parsing | engine |
| `packages/engine/src/funds.ts`, `policies.ts` | Typed `FundProfile` view of the registry; per-personality deterministic fallback policies and `enforceRiskLimit` | config |
| `packages/engine/src/metrics.ts`, `director.ts` | Pure evaluation metrics (series, concentration, events) and the World Director (public observation, rule policy, intervention validation, engine-built events) | config, engine types |
| `packages/engine/src/experiment.ts` | Pure controlled experiment worlds: `simulateWorld` (the live tick's engine calls, synchronous, policy brains), one-variable arm expansion, manifest hashes, paired cross-seed comparison | engine, config |
| `packages/engine/src/simMemory.ts` | Pure in-world memory for experiment worlds: `MemoryMode`, `updateSimMemory` (episodes and reflections into `SimFund.memory`, model-backed funds only, D-043) | engine memory, config |
| `packages/engine/src/behaviour.ts` | Pure behavioural metrics per fund-run: `computeBehaviour` over the decision trail, gross series and shocks (D-044) | engine experiment types |
| `packages/engine/src/stats.ts` | Pure experiment statistics: seeded percentile bootstrap CI of the mean, exact sign test, Holm correction (D-040) | engine market (PRNG) |
| `server/db.ts` | PrismaClient singleton | @prisma/client |
| `server/auth.ts` | Register/login (bcrypt, JWT), `requireAuth` middleware, `wrap()` async guard. Still mounted; the observer client no longer uses accounts | db |
| `server/worldCore.ts` | PURE world rules, no I/O: DB-row → engine shapes, `resolveWorldSeed`, `parseWorldSnapshot`, `addMissingCompanies`, `missingRegistryFunds`, `shouldFundDecide` (per-fund cadence/offset), `buildWorldStatePayload` (the public payload and its `WorldStatePayload` type) | engine |
| `server/world.ts` | The single live world (`ensureLiveWorld`, `getLiveWorld`, `withWorldLock`, `startWorldLoop`); 5s loop; snapshots + event logs; **one `Agent` per registered fund** (own cadence slot, pending flag, brain) + state-diff persistence; **liquidation of every fund** (`liquidateFunds`); **peak NAV tracking** (`trackPeakNav`) | db, engine, worldCore |
| `server/budget.ts` | PURE pricing (`costOfUsage`, `estimateCallCostUsd`) and the in-process `BudgetLedger` (reserve/settle per fund + global daily limit + concurrency cap, UTC-day rollover) | config |
| `server/providers/anthropic.ts` | The only provider adapter: `@anthropic-ai/sdk` beta messages call + the bounded tool loop `runDecisionLoop` (metered, never throws) | SDK, engine fundTools, budget |
| `server/providers/jev.ts` | Director mode resolution and the Jev adapter — a DISABLED STUB (no network call) until Jev's API contract is supplied | engine director types |
| `server/analyticsCore.ts` | PURE builder for the ANALYTICS payload (per-fund financial + AI-systems metrics, world, Director, limitations) | engine metrics |
| `server/labCore.ts` | PURE lab rules: experiment request validation, admin-token check, running a spec into its result, list/detail payloads | engine experiment |
| `server/labBrain.ts` | Model-backed experiment brains: `makeExperimentDecide` (live-world gate, prompts and tool loop, fallback to policy), per-experiment budget reservation (`BudgetExhausted`), worst-case `estimateExperimentCostUsd` (D-038, D-039) | engine experiment/policies/fundTools, budget, providers/anthropic |
| `server/experiments.ts` | The experiment runner: one queued experiment at a time, yielding between runs, buffers every decision into `ExperimentDecision` (one batch per run), persists `costUsd` after every paid call (D-042), re-queues policy-only runs on restart and fails model-backed ones (D-039). Never touches the live world | db, labCore, labBrain |
| `server/labRoutes.ts` | `GET /lab/experiments`, `GET /lab/experiments/:id`, `GET /lab/experiments/:id/runs/:arm/:seed` (public replay), `POST /lab/experiments` (LAB_ADMIN_TOKEN; `?dryRun=1` returns the worst-case estimate) | db, labCore |
| `server/observerCore.ts` | PURE builders for the investigation payloads: per-fund decision traces (model call + tool calls + memory) and the activity feed | engine types, worldCore types |
| `server/worldRoutes.ts` | `GET /world/state`, `GET /world/funds/:id/trace`, `GET /world/activity`, `GET /world/analytics` — public, no auth, read-only | db, world, worldCore |
| `server/index.ts` | Express app, routes (`/auth`, `/world`), error handler, world clock start | all server modules |
| `prisma/schema.prisma` | Postgres schema: User, World, Fund, Position, MarketTick, MarketEventLog, RivalDecisionLog (+ source/model/llmCallId), LiquidationLog, LlmCallLog, ToolCallLog, AgentMemory, FundNavSnapshot, DirectorDecisionLog, Experiment (+ `costUsd`, `hasModelBrains`), ExperimentDecision (one row per decision of every experiment run, cascade-deleted with its experiment). Init migration in `prisma/migrations/20261102000000_init` | @prisma/client |
| `src/store/gameStore.ts` | Read-only zustand projection of public `GET /world/state` (polled every 2.5s); focuses the lowest-id fund and summarises every fund (`funds`) for `FundsStrip`; no auth, lobby, local simulation or trading | engine, server API |
| `src/components/*` | Terminal UI (Hero, Mid, RivalPanel = FUND INTEL, FundSummaryPanel, PositionRow…). `App` renders only `<Terminal/>` | gameStore |
| `scripts/verify-backend.ps1` | One-command backend acceptance test (db → migrate → server → unattended tick growth) | docker, prisma, server |

## Data movement
- **Shared engine:** `packages/engine/src/*` — pure functions, zero I/O. Client (`src/`) and server (`server/`) both import it via `@black-sheep/engine/<module>`. Engine logic exists exactly once.
- **Server truth:** Postgres. `MarketTick.snapshotJson` (every 3 ticks) stores `{market, scheduler}` — full market snapshots, so a restart rebuilds the world without replaying t=0. `MarketEventLog` and `RivalDecisionLog` are append-only histories (the latter is the rival's reasoning archive for the future meta-game).
- **LiquidationLog**: append-only record of each fund liquidation — the definitive "this fund died here, for this reason" fact. Written server-authoritatively by `liquidateFunds` for any fund. `rivalContext` is a legacy column, always null since Stage 2 (D-019).
- **Fund.peakNav**: all-time high NAV, updated by the tick loop (`trackPeakNav`) (the post-trade `updatePeakNav` hook was removed with human trading in Stage 1). Display stat (result cards removed in Stage 1).
- **Fund.liquidated**: boolean set server-authoritatively when `checkLiquidation` flags a margin breach. The fund stays visible to observers (`LIQUIDATED — cause` in FundSummaryPanel) and stops deciding (D-019).
- **World process:** one in-memory `World` — the persisted `World` row named `live` (market + scheduler + one `Agent` per registry fund). The loop mutates memory, persists snapshots/logs/decision deltas; a restart rebuilds from the latest snapshot (corrupt → throws) + Fund/Position rows + last RivalDecisionLog entry, keeping the persisted seed (D-018).
- **World Director (D-029):** runs in the tick under the lock, sees only public conditions, can only fire validated catalog sector/macro events; every cycle is a `DirectorDecisionLog` row.
- **Experiment worlds (D-032):** independent pure simulations run by `server/experiments.ts`; they share no state, lock or tables with the live world. Model-backed arms (D-038) call the provider through the injected `DecideFn`, outside any world lock, against one hard per-experiment budget (D-039); every decision is persisted to `ExperimentDecision` for replay and export.
- **Leaderboard and replay (D-041):** derived on read: the leaderboard from `Experiment.resultJson` only (cached in memory per (count, max id) of done brains rows, D-042), the replay from `resultJson` plus that run's `ExperimentDecision` rows; no table of its own. `server/leaderboardCore.ts` is pure; the TIMELINE view and run replay are client views over the public `/lab/leaderboard` and `/lab/experiments/:id/runs/:arm/:seed` routes.
- **Secrets:** `ANTHROPIC_API_KEY` and `JWT_SECRET` live in `.env`, read server-side only. Only the server calls the LLM provider (the Vite browser proxy was removed in Stage 1).

## Boundaries
- **Lab writes are privileged (D-033):** creating experiments needs `LAB_ADMIN_TOKEN`; reading them is public.
- **Observation is public (D-017):** `GET /world/state` shows every fund's full book to anyone. **Agent isolation** lives in `buildDecisionInput`: an agent's `RivalDecisionInput` remains free of other funds' positions by construction. Agents never call the HTTP API.
- **Single writer:** one server process; every world mutation goes through `withWorldLock` (D-016).
- **Engine purity:** `packages/engine` has zero imports of express/prisma/react/zustand. If it needs I/O, the caller wires it (the provider call lives in `server/providers/`).
- **No engine duplication:** client and server never re-implement market/portfolio/rival math.
- **UI:** components read the client store via selectors only.


