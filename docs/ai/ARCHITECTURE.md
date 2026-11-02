# Architecture

## Modules
| Module | Responsibility | Talks to |
|---|---|---|
| `packages/engine` (`@black-sheep/engine`) | THE shared pure engine: market evolution/impact/flow, portfolio lifecycle, events, rival shell + LLM brain. UI-free, imported by client AND server | nothing |
| `config/funds.ts`, `config/models.ts` | Literal-only registries: the AI funds (identity, mandate, strategy, model, risk limit, cadence slot) and the models they may use (pricing, effort). Dependency-free so the engine can import them | nothing |
| `packages/engine/src/fundTools.ts` | Pure fund research tools (`FUND_TOOLS`, `runFundTool`) and `submit_decision` parsing | engine |
| `packages/engine/src/funds.ts`, `policies.ts` | Typed `FundProfile` view of the registry; per-personality deterministic fallback policies and `enforceRiskLimit` | config |
| `server/db.ts` | PrismaClient singleton | @prisma/client |
| `server/auth.ts` | Register/login (bcrypt, JWT), `requireAuth` middleware, `wrap()` async guard. Still mounted; the observer client no longer uses accounts | db |
| `server/worldCore.ts` | PURE world rules, no I/O: DB-row → engine shapes, `resolveWorldSeed`, `parseWorldSnapshot`, `addMissingCompanies`, `missingRegistryFunds`, `shouldFundDecide` (per-fund cadence/offset), `buildWorldStatePayload` (the public payload and its `WorldStatePayload` type) | engine |
| `server/world.ts` | The single live world (`ensureLiveWorld`, `getLiveWorld`, `withWorldLock`, `startWorldLoop`); 5s loop; snapshots + event logs; **one `Agent` per registered fund** (own cadence slot, pending flag, brain) + state-diff persistence; **liquidation of every fund** (`liquidateFunds`); **peak NAV tracking** (`trackPeakNav`) | db, engine, worldCore |
| `server/budget.ts` | PURE pricing (`costOfUsage`, `estimateCallCostUsd`) and the in-process `BudgetLedger` (reserve/settle per fund + global daily limit + concurrency cap, UTC-day rollover) | config |
| `server/providers/anthropic.ts` | The only provider adapter: `@anthropic-ai/sdk` beta messages call + the bounded tool loop `runDecisionLoop` (metered, never throws) | SDK, engine fundTools, budget |
| `server/worldRoutes.ts` | `GET /world/state` — public, no auth; builds the payload via `buildWorldStatePayload` | db, world, worldCore |
| `server/index.ts` | Express app, routes (`/auth`, `/world`), error handler, world clock start | all server modules |
| `prisma/schema.prisma` | Postgres schema: User, World, Fund, Position, MarketTick, MarketEventLog, RivalDecisionLog (+ source/model/llmCallId), LiquidationLog, LlmCallLog, ToolCallLog. Init migration in `prisma/migrations/20261102000000_init` | @prisma/client |
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
- **Secrets:** `ANTHROPIC_API_KEY` and `JWT_SECRET` live in `.env`, read server-side only. Only the server calls the LLM provider (the Vite browser proxy was removed in Stage 1).

## Boundaries
- **Observation is public (D-017):** `GET /world/state` shows every fund's full book to anyone. **Agent isolation** lives in `buildDecisionInput`: an agent's `RivalDecisionInput` remains free of other funds' positions by construction. Agents never call the HTTP API.
- **Single writer:** one server process; every world mutation goes through `withWorldLock` (D-016).
- **Engine purity:** `packages/engine` has zero imports of express/prisma/react/zustand. If it needs I/O, the caller wires it (the provider call lives in `server/providers/`).
- **No engine duplication:** client and server never re-implement market/portfolio/rival math.
- **UI:** components read the client store via selectors only.


