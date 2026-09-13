# Decisions

### D-001 · 2026-09-12 · Claude (Cline)
**Decision:** Anthropic API key stays server-side; the browser calls same-origin `POST /api/llm`, and a Vite **plugin** (`llmProxyPlugin` in `vite.config.ts`) injects the key and forwards to `api.anthropic.com/v1/messages`.
**Context:** No backend exists, but bundling `ANTHROPIC_API_KEY` into client JS would leak it to anyone opening DevTools.
**Reasoning:** `loadEnv(mode, cwd, '')` reads the key in the dev server only; it never reaches `import.meta.env` or the bundle. The relay is ~40 lines and testable end-to-end.
**Rejected:** Direct browser fetch with the key (leaks the secret); `VITE_ANTHROPIC_API_KEY` (still ships in the bundle); a standalone Express sidecar (extra process to run for a dev-only need).
**Tradeoff accepted:** Dev-only solution — production needs an edge function; and the dev proxy couples key provisioning to `vite.config.ts`.
**Revisit if:** The game ships to production or gains a real backend.

### D-002 · 2026-09-12 · Claude (Cline)
**Decision:** Rival decisions are fire-and-forget async: `tick()` stays synchronous, fires `makeLLMDecision(...).then(...)`, and a `rivalThinking` flag gates re-entry until the resolution lands.
**Context:** `tick()` runs on a fixed interval and must never stall on a network round-trip (2s ticks vs multi-second LLM latency).
**Reasoning:** The game keeps running while the rival "thinks" — which also makes the latency diegetic (the RivalPanel thinking state reads as intentional). Resolution re-reads current state via `get()` so it never applies a stale market snapshot.
**Rejected:** `await` inside `tick()` (would freeze the whole game loop per decision); a queue/worker (unneeded complexity for one call per 10 ticks).
**Tradeoff accepted:** The decision applies at resolution time, not decision time — prices may have moved; accepted because re-reading state at resolution is strictly more correct than freezing it.
**Revisit if:** Multiple rivals or per-tick decisions are introduced.

### D-003 · 2026-09-12 · Claude (Cline)
**Decision:** The rival trades through the same `openPosition`/`closePosition`/`applyTrade` functions as the player, and `makeLLMDecision` falls back to the deterministic `makeRandomDecision` twin on ANY failure (HTTP error, malformed JSON, network down).
**Context:** The point of a shared engine: if the math is correct for the player it is correct for the rival — no special-cased rival path to test separately.
**Reasoning:** A failure in the LLM layer must never crash or stall the game; the twin is correct-by-construction and free.
**Rejected:** Separate rival accounting math (double the test surface, risks drift); failing hard on LLM errors (game dies on a hiccup).
**Tradeoff accepted:** On fallback the rival's reasoning text is templated rather than LLM-authored — visible but acceptable degradation.
**Revisit if:** Personalities need non-contrarian logic (the twin is contrarian-specific).

### D-004 · 2026-09-12 · Claude (Cline)
**Decision:** `RivalDecisionInput` is the hard information firewall — the LLM sees public prices/flow/events plus its OWN book, and a vague `estimatedPlayerSectorExposure` derived from flow aggregates. Player positions and cash are structurally absent.
**Context:** The rival must be a plausible adversarial trader, not an oracle reading your book.
**Reasoning:** Deriving the exposure label inside `buildDecisionInput` keeps the boundary in one auditable type; the LLM literally cannot leak what it never receives.
**Rejected:** Passing sanitized player positions (still leaks shape/size); deriving exposure inside the prompt (non-deterministic, untestable).
**Tradeoff accepted:** The exposure signal is coarse (3 buckets) — the rival sometimes infers less than a human could from the tape.
**Revisit if:** Design wants richer (but still non-oracular) player reads.

### D-005 · 2026-09-12 · Claude (Cline)
**Decision:** `shouldRivalReconsider(input, lastInput)` skips the LLM call entirely when no event IDs changed, no net flow moved > $250k, and the rival's position count is unchanged.
**Context:** LLM calls cost real money; most decision ticks nothing material has changed.
**Reasoning:** A cheap structural diff gates the expensive call — the rival reuses its last decision instead of paying for a redundant "hold".
**Rejected:** Time-based throttling alone (still fires when nothing changed); always calling (cost scales with ticks × players × sessions).
**Tradeoff accepted:** A material-but-small flow shift (<$250k) won't trigger a reconsideration until the next threshold crossing.
**Revisit if:** Rival count grows or the decision cadence tightens.

### D-006 · 2026-09-12 · Claude (Cline)
**Decision:** Shared engine lives in a real package (`packages/engine` = `@black-sheep/engine`) wired via npm workspaces with a deep-exports map (`"./*": "./src/*.ts"`); both client and server import `@black-sheep/engine/<module>`. The engine stays a TS-source package (no build step) because both consumers already run TS-native toolchains (Vite, tsx).
**Context:** Phase 3 requires server and client to share Phases 1-2 engine code with zero duplication.
**Reasoning:** npm workspaces symlink + exports map is the smallest structural change; no bundler config, no precompile, and `tsc --noEmit` at the root typechecks client and engine together.
**Rejected:** Path aliases only (`tsconfig` paths) — works for tsc/Vite but not cleanly for tsx/Node; precompiling the engine to dist (adds a build step and a second source of truth); copying engine into server (explicitly forbidden — duplication).
**Tradeoff accepted:** Deep import paths instead of a single barrel; the package is private and internal so the coupling is controlled.
**Revisit if:** The engine is published externally or gains its own test/bundle pipeline.

### D-007 · 2026-09-12 · Claude (Cline)
**Decision:** Server stack is **Express 4 + Prisma 6 + tsx**, run as TypeScript source (`server:dev` = `tsx server/index.ts`).
**Context:** The user specced "Node.js + Express (or Fastify) + TypeScript" and "Postgres with Prisma".
**Reasoning:** Express 4 is the most conservative, best-documented choice; Prisma 6 keeps the classic `prisma-client-js` generator and `.env` auto-loading (Prisma 7's new generator/config/adapter model is a bigger migration than Phase 3 warrants); tsx runs TS with no build step in dev.
**Rejected:** Fastify (fewer shared references in this codebase's ecosystem, no functional gain here); Prisma 7 (installed by accident first — deliberately pinned down to 6 for stability); `tsc`-compiled server output (build step in dev for no benefit yet).
**Tradeoff accepted:** Express 4 does not catch async-handler rejections — every async route is wrapped (`wrap()` in server/auth.ts) or a rejection crashes the process.
**Revisit if:** We need HTTP/2, schema validation at scale, or Prisma 7's driver adapters.

### D-008 · 2026-09-12 · Claude (Cline)
**Decision:** The world keeps ONE in-memory `World` per active room and persists: full `MarketTick` snapshots every 3 ticks (not every tick), `MarketEventLog` rows, and rival state **deltas** (fund cash + added/removed positions + decision log) in a single transaction per decision.
**Context:** The spec: periodic snapshots so "what happened while you were away" reconstructs without replaying t=0, and the rival must keep deciding server-side.
**Reasoning:** Snapshot cadence bounds DB writes (3n) while a rebuild loses at most 2 ticks of drift; diffing position sets (keyed `ticker:direction:entryTimestamp`) avoids rewriting the whole position table and preserves closed-position history (which is also how rival `realizedPnL` is rebuilt, since the specced Fund schema has no such column).
**Rejected:** Persisting every tick (write amplification with no gameplay value); replaying events from t=0 (exactly what snapshots exist to avoid); a `realizedPnL` column (schema was user-specced — deriving from closed positions is lossless).
**Tradeoff accepted:** A server crash loses in-memory progress since the last snapshot (≤2 ticks ≈ 10s) — acceptable for a game.
**Revisit if:** Rooms count grows large (snapshot cadence and the unbounded `worlds` map both need eviction then).

### D-009 · 2026-09-12 · Claude (Cline)
**Decision:** `GET /rooms/:code/state` returns other funds as `{ id, name, userId, nav, netExposure }` aggregates only — positions and cash exist exclusively in the caller's own `me` block — and `flow` (per-ticker net flow) is public, exactly the signal the rival brain sees.
**Context:** "Do NOT leak other players' exact positions, only aggregate exposure signals" — the multiplayer generalization of the Phase 1 information firewall (D-004).
**Reasoning:** NAV is inherently public (it is the scoreboard); net exposure is the same class of aggregate the rival already infers from flow; per-ticker positions would make sniping trivial and break the game's core tension.
**Rejected:** Full secrecy of even NAV (kills the head-to-head stakes); per-ticker aggregate exposure (one step from leaking the book — could be added later deliberately, not accidentally).
**Tradeoff accepted:** A determined player can infer a rival's *lean* from NAV deltas plus public flow — that is intended gameplay, not a leak.

### D-010 · 2026-09-13 · Claude (Cline)
**Decision:** Phase 4 keeps the Phase-2 component tree byte-identical and swaps only the data layer: the store becomes a session + poll projection (`GET /rooms/:code/state` every ~2.5s), trades go through a new `POST /rooms/:code/trade` route with optimistic local fills reconciled by the next poll, and a new `RivalDecisionLog.{confidence,fillPrice,realizedPnL,tickCountAt}` telemetry trio (server persists, `/state` relays, client maps) preserves confrontation detection across the wire.
**Context:** The prompt demanded every component keep working "exactly as before" — a plumbing swap, not a redesign — while the missing trade route and the rival-telemetry gap in `/state` had to be closed on the server first.
**Reasoning:** zustand helpers moved to module scope (they capture `set`/`get` as args) so the creator returns one plain object literal — the earlier split-creator form is what produced the missing-field type error; `withWorldLock` serializes trade-vs-tick writes so no price impact is clobbered; optimistic fills use the same shared-engine functions so a rejected local fill and a rejected server fill agree.
**Rejected:** Keeping a local tick loop as fallback (two sources of truth); websockets (explicitly deferred per prompt — polling is fine for 2–4 players, upgrade path noted in Terminal.tsx).
**Tradeoff accepted:** A trade can appear twice (optimistic then authoritative) for one poll cycle; fill prices may differ by a tick of drift — the poll always wins.
**Revisit if:** Latency complaints → websocket push from `server/world.ts`; server-side player liquidation (still client-dormant `liquidated: false`).

### D-011 · 2026-09-13 · Claude (Cline)
**Decision:** The away-summary re-engagement mechanic uses a client-supplied `since` timestamp (ms epoch of the player's last `/state` poll, persisted in localStorage as `session.lastSeenAt`) as the window start. The server reconstructs "NAV then" from the nearest `MarketTick` snapshot at or before `since` (fallback: current prices → deltas degrade to ~0 rather than inventing history), computes per-position P&L deltas via the shared `positionDeltas` engine math, filters events to held tickers only, and replays logged rival decisions through the SAME `detectConfrontation` the live terminal uses. The `isNotable` gate (window ≥2min AND [NAV moved ≥$25K OR a position moved ≥$10K OR a confrontation happened]) runs server-side — the client only stores and renders the summary when `notable: true`.
**Context:** "What happened while you were away" is one of the highest-leverage, lowest-effort features — most of the hard work (persistence, snapshots, events, rival decisions) was already done in Phase 3.
**Reasoning:** Client-supplied `since` keeps the endpoint stateless (no server-side session needed for this). The `isNotable` gate on the server prevents the screen from showing on every refresh (which would train players to dismiss it). Reusing `detectConfrontation` and `positionDeltas` means the away math is tested by the same unit tests as the live math — no duplicate formula to drift.
**Rejected:** Server-side `lastSeenAt` tracking (would require a session table; the client already knows when it last polled). Showing the screen on every rejoin (would train players to ignore it). Reimplementing PnL math server-side (drift risk).
**Tradeoff accepted:** A clock-skewed or tampered client can widen/narrow the window — acceptable for V1 since `isNotable` is the real protection and the worst case is a slightly misleading "away" summary, not a security issue.
**Revisit if:** Away-summary integrity matters (move `lastSeenAt` server-side) or the snapshot cadence makes "NAV then" too coarse (currently every 3 ticks ≈ 15s).


