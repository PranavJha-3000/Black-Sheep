# Architecture

## Modules
| Module | Responsibility | Talks to |
|---|---|---|
| `packages/engine` (`@black-sheep/engine`) | THE shared pure engine: market evolution/impact/flow, portfolio lifecycle, events, rival shell + LLM brain. UI-free, imported by client AND server | nothing |
| `server/db.ts` | PrismaClient singleton | @prisma/client |
| `server/auth.ts` | Register/login (bcrypt, JWT), `requireAuth` middleware, `wrap()` async guard | db, engine (—) |
| `server/rooms.ts` | POST /rooms (code + rival fund), POST /:code/join, GET /:code/state — read-only; no human trade route since Stage 1 (firewall-respecting, now includes `liquidated`/`liquidationCause`/`liquidationRivalContext` in `me`) | db, engine, auth, world |
| `server/world.ts` | Per-room in-memory world; 5s loop; snapshots + event logs; rival decision cycle + state-diff persistence; **server-authoritative liquidation** (`liquidatePlayerFunds`); **peak NAV tracking** (`trackPeakNav`) | db, engine |
| `server/index.ts` | Express app, routes (auth, rooms), error handler, world clock start | all server modules |
| `prisma/schema.prisma` | Postgres schema: User, Room, Fund, Position, MarketTick, MarketEventLog, RivalDecisionLog | @prisma/client |
| `src/store/gameStore.ts` | Read-only zustand projection of `GET /rooms/:code/state` (polled every 2.5s); no local simulation, no trading actions | engine, server API |
| `src/components/*` | Terminal UI (Hero, Mid, RivalPanel, HeadToHead, ConfrontationBanner, PositionRow…) | gameStore |
| `scripts/verify-backend.ps1` | One-command backend acceptance test (db → migrate → server → unattended tick growth) | docker, prisma, server |

## Data movement
- **Shared engine:** `packages/engine/src/*` — pure functions, zero I/O. Client (`src/`) and server (`server/`) both import it via `@black-sheep/engine/<module>`. Engine logic exists exactly once.
- **Server truth:** Postgres. `MarketTick.snapshotJson` (every 3 ticks) stores `{market, scheduler}` — full market snapshots, so a restart rebuilds the world without replaying t=0. `MarketEventLog` and `RivalDecisionLog` are append-only histories (the latter is the rival's reasoning archive for the future meta-game).
- **LiquidationLog**: append-only record of each fund liquidation — the definitive "this fund died here, for this reason" fact. Written server-authoritatively by `liquidatePlayerFunds`. `rivalContext` captures what the rival was doing at the moment of death (null when it was pure leverage).
- **Fund.peakNav**: all-time high NAV, updated by the tick loop (`trackPeakNav`) (the post-trade `updatePeakNav` hook was removed with human trading in Stage 1). Display stat (result cards removed in Stage 1).
- **Fund.liquidated**: boolean set server-authoritatively when `checkLiquidation` flags a margin breach. The client renders `LiquidationScreen` when true; closing the tab cannot dodge it.
- **World process:** one in-memory `World` per active room (market + scheduler + rival fund); the loop mutates memory, persists snapshots/logs/rival deltas; a restart rebuilds from the latest snapshot + Fund/Position rows + last RivalDecisionLog entry.
- **Secrets:** `ANTHROPIC_API_KEY` and `JWT_SECRET` live in `.env`, read server-side only. Only the server calls the LLM provider (the Vite browser proxy was removed in Stage 1).

## Boundaries
- **Information firewall (multiplayer version):** `GET /rooms/:code/state` returns every fund's `{nav, netExposure}` but positions/cash ONLY for the caller's own fund. The rival brain's `RivalDecisionInput` remains positions-free by construction.
- **Engine purity:** `packages/engine` has zero imports of express/prisma/react/zustand. If it needs I/O, the caller wires it (see `LLMEndpointOptions`).
- **No engine duplication:** client and server never re-implement market/portfolio/rival math.
- **UI:** components read the client store via selectors only.


