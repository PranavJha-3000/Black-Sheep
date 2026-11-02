# Decisions

### D-025 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Every provider call reserves its worst-case cost first (`server/budget.ts` `BudgetLedger`): `MAX_TOOL_ROUNDS` rounds of `DECISION_MAX_TOKENS` output, where round k re-sends the prompt (`DECISION_PROMPT_TOKENS_ESTIMATE`) plus every earlier assistant turn, at the model's registry price (~$0.47 on Opus 5.5), held against the fund's `dailyBudgetUsd` ($2) and `GLOBAL_DAILY_BUDGET_USD` ($10) and capped at `MAX_CONCURRENT_LLM_CALLS` (2) in flight. A refused reservation makes the fund play its policy, recorded with `source: 'budget'` (a budget is exhausted) or `'busy'` (the concurrency cap is full). The SDK client times out after `LLM_TIMEOUT_MS` (90 s) with `LLM_MAX_RETRIES` (1), and a reservation is released if anything throws before it settles, so a slot can never leak. After the call the reservation is settled with the real cost (each round priced by the model that served it, cache reads/writes via registry multipliers; an unknown model is priced at the most expensive rate). Budgets reset at the UTC day boundary and are re-seeded on boot from today's `LlmCallLog.costUsd`. Every call is persisted as an `LlmCallLog` row (tokens, cost, latency, outcome, served-by model) with its `ToolCallLog` rows; every `RivalDecisionLog` row carries `source` (`llm` | `policy` | `budget` | `busy`), `model` and `llmCallId`. The public payload exposes each registered fund's `spend {todayUsd, dailyBudgetUsd}` and its last decision's `source`/`model`; FundsStrip shows them. Migration `20261102020000_decision_metering`.
**Context:** VISION §12 — "no agent should continue making API calls after its budget is exhausted"; Stage 3 shipped ~3.6 uncapped Opus calls a minute.
**Reasoning:** Reserving before the call is the only way a slow, concurrent call cannot overshoot the limit. The server is the single writer (D-016), so an in-process ledger is atomic; persisting the calls makes restarts unable to reset spend. Recording the source lets observers (and later analytics) tell model decisions from fallbacks.
**Rejected:** Checking spend after the call (overshoots by up to one call per fund); a DB-backed ledger with row locks (unneeded with one writer, unverifiable without Postgres); hiding spend from observers (VISION §13 wants cost visible).
**Tradeoff accepted:** The worst-case estimate (~$0.47 per Opus call) is held while a call runs, so the strip's spend briefly includes it and a $2 budget admits ~4 calls in flight; real calls cost far less. Tool-result tokens are folded into the prompt estimate.
**Revisit if:** budgets must be edited at runtime, more than one server process writes, or calls become streaming/longer than `DECISION_MAX_TOKENS`.

### D-024 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Funds research with five read-only tools defined in the pure engine (`packages/engine/src/fundTools.ts`): `inspect_company`, `inspect_portfolio`, `calculate_risk`, `recent_events` and `submit_decision` (every schema `additionalProperties: false`). The server runs a bounded manual loop (`runDecisionLoop`): at most `MAX_TOOL_ROUNDS` (4) rounds of `DECISION_MAX_TOKENS` (4096), a "Final round: call submit_decision now." nudge before the last round, malformed `submit_decision` answered with an error result so the model may retry, a bare-JSON text answer accepted as a fallback, and every exit (`decided`, `refusal`, `max_tokens`, `round_cap`, `no_decision`, `error`) logged. No `tool_choice` is forced (Opus 5.5 always thinks; forcing returns 400) and no `strict` schemas. The model is only woken when `shouldRivalReconsider` sees a material change since it last looked; otherwise the policy decides (it still handles stops and targets). Whatever the model submits still passes `enforceRiskLimit`; a missing or non-positive `dollarAmount` on an open becomes a hold.
**Context:** VISION §6/§12 — funds should research before deciding, with bounded cost and the engine as the arbiter.
**Reasoning:** Tool handlers are pure functions of the same `RivalDecisionInput` the policy sees, so agent isolation (D-017) holds by construction and they are unit-testable. A manual loop (not the SDK tool runner) lets the server meter each round and stop on a round cap.
**Rejected:** SDK tool runner (no per-round cost hook, no round cap semantics we control); forced `tool_choice` (400 on Opus 5.5); tools that mutate state (the engine must validate, not the model).
**Tradeoff accepted:** A model that ignores the nudge wastes its last round and the policy decides; thinking can consume most of 4096 tokens — logged as `max_tokens`.
**Revisit if:** funds need richer actions (limit orders, pair trades) or memory tools (Stage 5).

### D-023 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Provider calls go through the official `@anthropic-ai/sdk` (new dependency, `^1.3.0`) in a server-only adapter, `server/providers/anthropic.ts`, using `client.beta.messages.create` with the `server-side-fallback-2026-07-01` beta and `fallbacks: 'default'`, `output_config.effort` from the model registry. The engine's `rivalLLM.ts` is now pure (prompt building and decision parsing only); `makeLLMDecision`, `fetch` and the endpoint types are gone. The `create` function is injected so the loop is tested without a network.
**Context:** VISION §14 — server-side provider adapters; the Stage 1–3 path was a hand-rolled `fetch` inside the engine.
**Reasoning:** The SDK owns retries, typing and beta headers; keeping it out of the engine preserves engine purity (no I/O) and keeps credentials server-side. Server-side fallback means a refused request can be re-served by the platform's default fallback model, and each round is priced by `res.model` so the meter stays honest.
**Rejected:** Keeping raw `fetch` (re-implements typing and retries); putting the SDK in the engine (breaks purity, would pull a network client into the browser bundle).
**Tradeoff accepted:** One new runtime dependency; `npm audit` high/critical findings are pre-existing (express/prisma transitive), not from the SDK.
**Revisit if:** a second provider is added (introduce a provider interface beside `CreateMessage`).

### D-022 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The market lists 10 companies across 8 sectors (adds VOLT energy, FORGE industrial, CURA biotech, LEDG finance; `Sector` gains `energy | industrial`). A persisted snapshot that predates a listing gains it at its seed price on load (`addMissingCompanies` in `server/worldCore.ts`); existing companies are never touched.
**Context:** VISION §15 asks for ~10 companies; the live world may already hold a 6-company snapshot.
**Reasoning:** New seeds are appended after the original six, so the original companies keep their per-tick noise stream; merging on load extends a running world instead of resetting it.
**Rejected:** Resetting the world on universe change (destroys observed history); requiring a manual migration of `snapshotJson` (error-prone, unverifiable without a DB).
**Tradeoff accepted:** `generateEvent` picks a ticker by `rng * count`, so the ambient event sequence after this change differs from what a 6-company world would have produced.
**Revisit if:** listings must be delisted/renamed (needs an explicit corporate-actions path).

### D-021 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Each personality has a pure, deterministic fallback policy (`packages/engine/src/policies.ts`, `decideByPolicy`): cautious = take profit +8% / stop −6%, else buy the deepest dip (≤ −1%) among low-volatility names (≤ 0.02); aggressive = take profit +10% / stop −8%, else short the worst recent negative event (≤ −2%), else the most overextended gainer (≥ +3%); quant = close when flow turns ≥ $250K against a position, else follow the strongest |flow| / liquidity above $250K; contrarian = the original crowd-fade twin. `enforceRiskLimit` clamps every opening decision — policy **and** LLM — to `maxPositionFraction × min(NAV, availableCash)`, keeps the book's gross exposure ≤ `POLICY_MAX_GROSS_LEVERAGE` (1.5) × NAV, and turns an unaffordable open into a hold. Sizing uses NAV because a short credits its proceeds to cash — cash-based sizing compounded short exposure with every trade (review finding). Thresholds live in `config/game.ts` (`POLICY_*`).
**Context:** VISION §6 gives every fund a rule-based fallback, and §12 requires the world to run with no provider key. Before Stage 3 every fund fell back to the same contrarian twin.
**Reasoning:** In-character fallbacks keep the three funds distinguishable when a provider is down or no key is configured; clamping LLM sizes enforces the fund's risk limit regardless of what the model proposes ("LLM proposes, engine validates").
**Rejected:** One shared fallback (funds become indistinguishable without a key); trusting the model's sizing (a hallucinated "all in" would breach the mandate).
**Tradeoff accepted:** Policies are simple heuristics, not alpha; they exist to keep the world alive and in character.
**Revisit if:** Stage 4 tool use gives models richer actions than buy/short/close/hold.

### D-020 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Fund identity is configuration. `config/funds.ts` (`FUND_REGISTRY`) lists three funds — STERLING & VALE (cautious value/macro, 12% max position, offset 0), HALDEN WHITMORE (aggressive event-driven short seller, 20%, offset 3), CROWN MERIDIAN (quant flow-momentum, 15%, offset 6) — each deciding every 10 ticks in its own staggered slot. `config/models.ts` (`MODEL_REGISTRY`) holds per-model pricing (USD/MTok: Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0.10/0.50) and effort. Every fund uses `claude-opus-5-5` at effort `low`, `max_tokens` 2048. A registry entry is matched to its `Fund` row **by name** (already `@@unique([worldId, name])`); missing registry funds are upserted on load; funds outside the registry (Stage 2's `APEX CAPITAL`) stay observable and liquidatable but never decide. The public payload carries each fund's `profile` (key, personality, mandate, strategy, model) or `null`.
**Context:** VISION §5–6 and §15 call for ~3 distinct funds with their own mandate, model and risk limits; Stage 2 ran a single contrarian rival.
**Reasoning:** Config keeps adding a fund a one-entry change and keeps the engine pure. Name-as-identity avoids a migration that cannot be verified without a database, and a renamed fund starting fresh protects track-record integrity. Opus 5.5 is the current default model; cheaper models are a one-line registry change once the user names one. Effort `low` and staggered slots bound cost and keep one fund's slow call from blocking the others.
**Rejected:** A `Fund.profileKey` column + migration (unverifiable now, no functional gain yet); deleting the legacy APEX fund (destroys observed history); hardcoding fund identities in `server/world.ts`.
**Tradeoff accepted:** With a key configured the world makes ~3.6 Opus calls a minute (≈ one per fund per 50 s) with no budget cap until Stage 4's cost meter.
**Revisit if:** funds need renaming without losing history (add a stable key column), or Stage 4 budgets demand cheaper default models.

### D-019 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Every fund, AI included, is subject to server-authoritative liquidation (`liquidateFunds` in `server/world.ts`). A liquidated fund stays visible to observers but never decides again (`shouldFundDecide` gates on `liquidated`, and `decideRival` drops a decision that resolves after its fund died). `LiquidationLog.rivalContext` is written as `null`.
**Context:** Before Stage 2 only human funds could be liquidated, and `computeRivalContext` narrated the death relative to the rival. With no humans, that left the only funds in the world immortal.
**Reasoning:** A research lab about fund survival needs funds that can fail (VISION: survival and drawdown are measured outcomes). Keeping the dead fund visible preserves the record observers came to see.
**Rejected:** Removing liquidated funds from the world (loses the record); restarting them with fresh capital (silently resets an experiment); keeping a rival-context narrative (the player-vs-rival story is gone).
**Tradeoff accepted:** The `rivalContext` column is kept but always null — a dead column until a schema pass drops it.
**Revisit if:** Stage 3 adds fund relationship memory (reuse the column for "who crowded whom") or experiments need fund revival rules.

### D-018 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The world seed is resolved once and persisted on `World.seed`. On first boot it is `WORLD_SEED` env when that is a decimal integer in `[0, 2147483647]`, else `config/game.ts` `WORLD_SEED` (20261102). Afterwards the persisted row always wins; a different env value only logs a warning. A corrupt latest snapshot throws instead of starting a fresh market.
**Context:** Each room used to derive its RNG seed from `room.id`. One persistent world needs a seed that survives restarts and is reproducible (VISION §10).
**Reasoning:** Persisting the seed makes a restart resume the same world. Treating env as first-boot-only stops a stray deploy variable from silently forking an observed world. Failing loudly on corruption protects the history observers have watched.
**Rejected:** Reading the seed from env on every boot (a config change would reseed a live world); auto-recovering from a corrupt snapshot with a fresh market (silent data loss).
**Tradeoff accepted:** Changing the live world's seed requires a DB edit or a new world row; a corrupt snapshot stops the clock until fixed by hand.
**Revisit if:** Experiment mode (separate seeded worlds) arrives — each world row already carries its own seed.

### D-017 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Observation is public. `GET /world/state` needs no account and shows every fund's book (cash, positions, exposure, last decision, liquidation cause). Agent isolation lives where agents read — `buildDecisionInput` — not in the HTTP API. The client imports the payload type (`WorldStatePayload`) type-only from `server/worldCore.ts`.
**Context:** The old `/rooms/:code/state` hid other funds' books from the caller because the caller was a competing player. Now the caller is a human observer and competes with no one.
**Reasoning:** Observers need the whole picture (VISION §13). Agents never call the HTTP API, so their firewall is unaffected. Sharing the type removes a hand-maintained mirror that could drift.
**Rejected:** Keeping JWT auth on observation (no account exists to protect anything); a per-fund firewall in the API (protects nobody now).
**Tradeoff accepted:** Anyone who can reach the server can read the full world state. `server/auth.ts` stays mounted but unused by the client.
**Revisit if:** Private experiments or paid access appear, or an agent is ever given HTTP access (then it must get a filtered view).

### D-016 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** `World` replaces `Room`. Every table keeps a `worldId` foreign key, and the server runs one persistent world named `live`, loaded by `ensureLiveWorld()` and written by one module-level `withWorldLock` chain. Rooms, lobby, join, auth screens and per-room worlds are removed. The init migration (`prisma/migrations/20261102000000_init`) is generated offline from the schema.
**Context:** VISION describes one shared financial world that runs whether or not anyone watches. The parked `wip/stage2-global-world` branch dropped the FK for a singleton `id = 1`, deleted the tick loop and had invalid migration SQL.
**Reasoning:** Keeping `worldId` costs nothing now and lets separate experiment worlds arrive later without a second schema migration. The parked branch was used only as a reference.
**Rejected:** A singleton world without an FK (forces another migration for experiment mode); finishing the parked branch (broken loop, invalid SQL).
**Tradeoff accepted:** Exactly one in-process writer — running two server processes against one DB would double-tick the world.
**Revisit if:** The server must scale out (add Postgres advisory-lock leader election) or experiment mode needs several concurrent worlds.

### D-015 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Stage 1 of the research-lab pivot is subtraction only. Remove what is irrelevant AND not load-bearing (human trading, browser LLM proxy, away-summary, result cards + `@vercel/og`); defer what is irrelevant but load-bearing (rooms/lobby/per-room worlds, the player Fund, the single rival, player-game UI) to the stages that replace it. `makeLLMDecision`'s endpoint becomes required so no browser path can exist.
**Context:** `docs/VISION.md` turns the game into an autonomous AI hedge-fund laboratory where humans observe. The repo carried player-game features, and an unfinished global-world refactor had left `main`'s working tree failing the server typecheck.
**Reasoning:** Each removal is one vertical slice and keeps typecheck, tests, lint and build green. The engine, liquidation, persistence and auth are reused by later stages (VISION §17 "preserve reusable financial infrastructure").
**Rejected:** A big-bang rewrite to a global world plus observer API in one change — it breaks "one logical change" and leaves the tree unbuildable mid-way. Finishing the parked WIP first — it is Stage 2 work with an invalid migration, not cleanup.
**Tradeoff accepted:** The UI is still a player-shaped terminal (now read-only) until the observer UI lands; some dead names remain (`Phase 'trading'`, `Fund.lastSeenAt`).
**Revisit if:** Stage 2 finds a deferred component is not actually load-bearing — then delete it there.

### D-014 · 2026-10-09 · Muse Spark (Cline)
**Decision:** All gameplay tuning constants move to a single dependency-free `config/game.ts` (design doc §11), and the pure engine (`packages/engine/src/{market,portfolio,rival,events,away}.ts`) imports them via a relative path (`../../../config/game`). Re-exports preserve old import sites (`export { INITIAL_MARGIN_RATE }`, `export { RIVAL_DECISION_TICKS }`, `export { AWAY_MIN_MS, ... }`, `export { STARTING_CAPITAL } from '../../config/game'` in derive.ts), so server/client/tests keep compiling unchanged.
**Context:** Spec-vs-code audit found constants hardcoded across ~10 files with `STARTING_CAPITAL = 10_000_000` duplicated in server, client store, and RivalFund.tsx — drift risk and a direct §11 violation.
**Reasoning:** One source of truth per value; values moved byte-identical (no behavior change, 84/84 tests pass). Config stays literal-only (no imports, no I/O) so the engine boundary keeps holding — it imports data, never express/prisma/react.
**Rejected:** Per-package tuning files (`packages/engine/tuning.ts` + `server/tuning.ts`) — perpetuates the split §11 forbids; adding an `@black-sheep/config` workspace package — new dependency/workspace wiring without approval.
**Tradeoff accepted:** Engine reaches outside its package root via relative path; acceptable because the imported module is dependency-free and the alternative (duplicating values) is the bug being fixed.
**Revisit if:** A package boundary or bundler config ever enforces strict import zones (then add a path alias or workspace package).

### D-001 · 2026-09-12 · Claude (Cline)
**Superseded 2026-11-02 by D-015** (browser LLM proxy removed; provider calls are server-only).
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
**Superseded 2026-11-02 by D-015** (away-summary re-engagement mechanic removed).
**Decision:** The away-summary re-engagement mechanic uses a client-supplied `since` timestamp (ms epoch of the player's last `/state` poll, persisted in localStorage as `session.lastSeenAt`) as the window start. The server reconstructs "NAV then" from the nearest `MarketTick` snapshot at or before `since` (fallback: current prices → deltas degrade to ~0 rather than inventing history), computes per-position P&L deltas via the shared `positionDeltas` engine math, filters events to held tickers only, and replays logged rival decisions through the SAME `detectConfrontation` the live terminal uses. The `isNotable` gate (window ≥2min AND [NAV moved ≥$25K OR a position moved ≥$10K OR a confrontation happened]) runs server-side — the client only stores and renders the summary when `notable: true`.
**Context:** "What happened while you were away" is one of the highest-leverage, lowest-effort features — most of the hard work (persistence, snapshots, events, rival decisions) was already done in Phase 3.
**Reasoning:** Client-supplied `since` keeps the endpoint stateless (no server-side session needed for this). The `isNotable` gate on the server prevents the screen from showing on every refresh (which would train players to dismiss it). Reusing `detectConfrontation` and `positionDeltas` means the away math is tested by the same unit tests as the live math — no duplicate formula to drift.
**Rejected:** Server-side `lastSeenAt` tracking (would require a session table; the client already knows when it last polled). Showing the screen on every rejoin (would train players to ignore it). Reimplementing PnL math server-side (drift risk).
**Tradeoff accepted:** A clock-skewed or tampered client can widen/narrow the window — acceptable for V1 since `isNotable` is the real protection and the worst case is a slightly misleading "away" summary, not a security issue.
**Revisit if:** Away-summary integrity matters (move `lastSeenAt` server-side) or the snapshot cadence makes "NAV then" too coarse (currently every 3 ticks ≈ 15s).

### D-012 · 2026-09-13 · Claude (Cline)
**Decision:** Fund liquidation is server-authoritative and runs inside the world tick loop (`liquidatePlayerFunds` in `server/world.ts`, serialized by `withWorldLock`). When `checkLiquidation` flags a player fund, the server force-closes every open position at the current market price, marks `Fund.liquidated = true`, computes `deriveCauseOfDeath`, derives a rival-context line by replaying the last 6 `RivalDecisionLog` rows through the shared `detectConfrontation`, and writes a `LiquidationLog` — all in one transaction. The client is told via `/state` (`me.liquidated`/`liquidationCause`/`liquidationRivalContext`) and renders `LiquidationScreen`.
**Context:** Phase 4 kept liquidation client-dormant (`liquidated: false`), which meant a player closing their tab could dodge a margin call — the exact cheat the whole persistent-world design exists to prevent.
**Reasoning:** The market and rival already move unattended server-side; liquidation is the same class of server-truth event. Reusing `liquidateFund`/`deriveCauseOfDeath`/`checkLiquidation`/`detectConfrontation` means zero duplicated math and the rival-context line is free. Running inside the room lock serializes it against trades/ticks so cash can't be double-spent.
**Rejected:** Client-triggered liquidation (dodgeable by tab close); a NAV-based liquidation threshold (engine only exposes margin-based `checkLiquidation`; scope creep); a separate liquidation event stream (`LiquidationLog` already mirrors the append-only log pattern of the other tables).
**Tradeoff accepted:** `peakNav` is maintained by the tick loop + a post-trade hook rather than being reconstructed from history, so the very first tick after fund creation may miss a peak that occurred before the first poll — acceptable for V1 (the peak is a display stat, not accounting truth).
**Revisit if:** Liquidation must trigger mid-tick (before other funds are evaluated in the same pass) or realized-PnL accounting needs the engine `history` array rather than the scalar `peakNav`.

### D-013 · 2026-09-13 · Claude (Cline)
**Superseded 2026-11-02 by D-015** (result cards and `@vercel/og` removed).
**Decision:** Result cards are served by two PUBLIC (unauthenticated) endpoints — `GET /funds/:id/result-card` (JSON) and `GET /funds/:id/result-card.png` (1200×630 PNG rendered via `@vercel/og` `ImageResponse`). The image is built with `React.createElement` objects (no JSX, since the server has no build step for tsx) in the terminal aesthetic (dark bg, mono font, green/red NAV, cause-of-death + rival-context). The SHARE button on both `FundSummaryPanel` (always-accessible sidebar) and `LiquidationScreen` copies the JSON card URL to the clipboard.
**Context:** The prompt asked for the cheapest legitimate distribution mechanic — real player outcomes, not synthetic virality — shareable at any NAV (a fund up 300% is as shareable as one that blew up).
**Reasoning:** "The link is the share" — a shareable card must be openable by anyone who sees the URL, so auth would break the whole mechanic. The payload is intentionally aggregate-only (NAV/peak/cause/best-trade) so the information firewall holds even for unauthenticated viewers. `@vercel/og` is purpose-built for OG cards and needs no native Cairo deps (unlike `node-canvas`, which is fragile on Windows); satori's default font keeps it dependency-free, with a TTF-load upgrade path noted.
**Rejected:** `node-canvas` (native deps, fragile install); authenticated result cards (breaks sharing); exposing positions/cash on the card (violates the firewall the entire multiplayer design rests on).
**Tradeoff accepted:** fund ids are auto-increment integers, so a card URL is guessable — acceptable for V1 (the data is aggregate-only, and the worst case is viewing another fund's headline stats). If that matters, swap in an opaque share token on the Fund.
**Revisit if:** Cards must be private (add a share token) or the exact JetBrains Mono face is required (bundle a TTF and pass it via `ImageResponse`'s `fonts` option).



