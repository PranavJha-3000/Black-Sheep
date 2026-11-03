# Decisions

### D-036 · 2026-11-03 · Claude Opus 5.5 (Claude Code)
**Decision:** Add `embedded-postgres` (dev dependency, pinned `16.14.0-beta.17`; the package tags every release "beta") and `npm run db:local` (`scripts/local-db.ts`): a real Postgres 16 from npm binaries on :5432 with docker-compose's credentials, data in git-ignored `.pgdata/`. Docker stays supported (`npm run db:up`).
**Context:** User asked for a demoable build where only connecting APIs is left. Docker Desktop on this machine fails to start its engine (WSL bootstrap error), which had blocked every live-DB check since Stage 2.
**Reasoning:** Same Postgres major as the compose file, no system install, one command. With it all five migrations applied, `prisma migrate diff` against the schema reported no drift, and the server, world loop, lab runner and every observer view were exercised on real data.
**Rejected:** PGlite (not wire-compatible with Prisma without an extra socket shim); debugging Docker Desktop (machine state outside the repo).
**Tradeoff accepted:** ~30 MB of platform binaries in `node_modules` for dev only. Two Postgres instances cannot share :5432 — run `db:local` or `db:up`, not both.
**Revisit if:** Docker works on every dev machine, or production needs a managed Postgres (this is dev-only).

### D-035 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Liquidation is judged on the whole fund. `checkLiquidation` now flags a fund when its equity (NAV = cash + longs − shorts, at market) falls below `MAINTENANCE_MARGIN_RATE` (25%) of its shorts' current value. Before, only each short's posted margin plus its own P&L counted, so free cash never backed a short. Initial margin is unchanged: 50% of a new short is still locked out of `availableCash`. `LIQUIDATION_RULE_VERSION = 2` is in `config/game.ts`, so experiment manifests from the old rule hash differently. The client's `liquidationAt` (the NAV at which the fund dies) is now 25% of the short book.
**Context:** User decision 2026-11-02 after D-034. Under the old rule a $10M fund with one $2M short up ~20% was liquidated while holding ~75% of NAV in cash; the old `liquidationAt` showed such a fund dying at a NAV of $9.5M (a 5% drawdown).
**Reasoning:** A broker issues a margin call before force-closing, and a fund with free cash posts it; equity vs maintenance on the whole account is the standard (Reg-T style) test. Measured on seeded 2000-tick experiment worlds (seeds 1–40) with the D-034 policies: 0 liquidations in 240 aggressive/quant runs (seeds 1–40 × Director none/rule), versus 1 of 180 on seeds 11–40 under the old rule. Mean returns barely move (seeds 11–40: HALDEN −0.5% / −0.3%, CROWN −5.4% / −7.2%). A fully levered short book (policies' 1.5× gross ceiling) now dies at a ~33% adverse move instead of ~20% per short.
**Rejected:** Auto-depositing free cash into a short's `marginReserved` on a call (same outcome, more mutable state and a second source of truth for collateral); keeping the per-short rule and only fixing the display (the rule itself was the unrealistic part).
**Tradeoff accepted:** Liquidation is now much rarer; a fund mostly dies only after losing most of its equity. Results and liquidation counts from experiments run before this change are not comparable with new ones (the manifest's `worldConstantsHash` changed). D-034's volatility cap stays, as a loss limiter rather than a survival rule.
**Revisit if:** longs become marginable (then longs need their own maintenance requirement), or funds should be able to die faster for drama (raise `MAINTENANCE_MARGIN_RATE`, not the old rule).

### D-034 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The policy funds keep their characters but stop shorting into margin calls. (1) No policy shorts a name with per-tick volatility above `POLICY_MAX_SHORT_VOLATILITY = 0.025` (HELX, CURA, ORBL, NOVA are now long-only for policies). (2) `exitOnTarget` cuts the worst stopped-out position before it banks any winner — this also changes STERLING & VALE (cautious), which shares it. (3) The quant policy has a stop, `POLICY_QUANT_STOP_LOSS = 0.12`, checked before its flow exits.
**Context:** In experiment worlds HALDEN WHITMORE and CROWN MERIDIAN were margin-liquidated in 38 of 40 seeded 2000-tick runs (10 seeds × Director none/rule). Every death was one short ~20% underwater while the fund held most of its NAV in cash: a lone short is liquidated at a ~20% adverse move (50% initial vs 25% maintenance margin), policies act every 10 ticks, and HELX's 10-tick sigma is ~11% (uniform per-tick noise, sd = volatility/sqrt(3)) before event shocks, so a 20% move between two decisions is routine. The rest were slow grinds the quant (no stop) never cut, or a stop skipped because a winner was banked first.
**Reasoning:** Measured with `simulateWorld` before/after. Seeds 1–10: liquidations 38 → 0. Held-out seeds 11–40: 1 of 180 aggressive/quant runs liquidated (a 2.3-sigma TITAN run-up under the Director). Mean 2000-tick return on seeds 11–40 (none / rule Director): HALDEN −0.5% / −0.5%, CROWN −5.4% / −7.4%, STERLING +0.9% / +3.0%. A quant stop of 0.08 or 0.10 survived too but churned (CROWN −17% / −12% on seeds 1–10); 0.15 let liquidations back in.
**Rejected:** Changing the liquidation rule so free cash tops up the margin account (realistic, but a world rule that also changes model-driven funds and every past experiment — a separate decision for the user); smaller short sizes (the liquidation distance is the same fraction whatever the size); deciding more often (changes cadence, cost and the live world's rhythm).
**Tradeoff accepted:** The policies are less "aggressive" in the most volatile names, and CROWN still loses money on average — this fixes survival, not alpha. Model-driven funds are not constrained (enforceRiskLimit is unchanged), so an LLM can still short HELX.
**Revisit if:** the margin rule changes (free cash posted as collateral), the decision cadence changes, or ticker volatilities are recalibrated.

### D-033 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The Research Lab has its own authorization boundary. `GET /lab/experiments` and `GET /lab/experiments/:id` are public observation. `POST /lab/experiments` needs `Authorization: Bearer <LAB_ADMIN_TOKEN>`: unset token → 503 (lab writes disabled), missing/wrong bearer → 401, then request validation → 400. The token is compared as SHA-256 digests with `timingSafeEqual`. The client sends it with the create request only; it is never stored in the store or browser storage.
**Context:** VISION §13 — "Public observation and privileged experiment configuration must have separate authorization boundaries."
**Reasoning:** A single shared secret is the smallest boundary that keeps experiment creation (which consumes server CPU) privileged without user accounts. Disabled-by-default means a fresh deploy cannot be used to queue work.
**Rejected:** Reusing `/auth` JWT accounts (the observer client no longer has accounts); IP allow-lists (brittle behind proxies); no auth (VISION violation).
**Tradeoff accepted:** One token for every admin, no per-user audit; CORS is still `*`, so the token's secrecy is the whole boundary.
**Revisit if:** more than one operator needs distinct permissions, or model-backed experiments add spend (then also a per-experiment budget).

### D-032 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Controlled experiment worlds (VISION §10 Mode B) are a pure engine simulation, `simulateWorld(arm, seed)` in `packages/engine/src/experiment.ts`, that mirrors the live tick (`tickMarket`, scripted then random event with the live RNG formula, rule Director on its slot with a separate RNG, liquidation, NAV every 3 ticks, each fund on its slot through `buildDecisionInput` → `decideByPolicy` → `enforceRiskLimit` → `applyTrade` → `applyRivalDecision`; funds deciding on the same tick all read the pre-trade market and trade in registry order, as live), synchronously and with no I/O. An experiment varies ONE variable (`directorMode`, `funds`, `decisionEveryTicks`) across 2–6 arms and runs every arm on the same 1–10 seeds (≤ 5000 ticks), so arms are paired run for run. Results (`compareArms`: n, mean, sample std, survival, paired Δ and wins vs each fund's baseline — the first arm that contains it, so a mixed world is compared with each fund alone; first-seed NAV series downsampled to 200 points; per-run digests) and a reproducibility manifest (canonical-JSON FNV-1a hashes of the spec, every fund profile and every `config/game.ts` constant; seeds; policy-only flag; recomputed when the experiment runs, so it describes the code that ran) are stored as JSON on one `Experiment` row (migration `20261102050000_experiments`). `server/experiments.ts` runs one queued experiment at a time, yielding to the event loop between runs; it never touches the live world, its lock or live tables, and a restart re-queues a running experiment. Experiments are policy-only — no model calls, no spend (user decision 2026-11-02).
**Context:** VISION §10 (Mode B, reproducibility, one variable at a time) and §15; scope bar: Emergence World's per-model worlds + mixed world, Project Napoleon's rival LLMs (user, 2026-11-02).
**Reasoning:** Reusing the engine functions means an experiment world is the live world's rules, not a model of them. Synchronous simulation is fast (~42 ms per 5000-tick 3-fund run) and exactly reproducible; digests let anyone confirm a rerun. JSON results keep the schema to one table while the result shape is still settling.
**Rejected:** Running experiment worlds through `server/world.ts` with DB rows per tick (slow, couples experiments to the live writer); per-run tables (premature); model-backed arms now (spend, user declined for this stage); a significance test (too few seeds to claim one honestly).
**Tradeoff accepted:** Results compare policies and world settings, not language models, until model arms exist. A `decisionEveryTicks` arm also changes which funds share a decision tick (offsets are taken modulo the cadence) — a confound to state when reading cadence results. The manifest hashes config and profiles, not engine/policy code: pin a git revision when publishing a result. Memory has no effect on policies, so memory ablations wait for model arms. JSON results are not queryable across experiments. `openPosition` stamps ids with the wall clock, so digests cover prices and NAVs only.
**Revisit if:** model-backed arms are approved (add a per-experiment budget and run model calls outside any lock), or cross-experiment queries are needed (normalise runs into tables).

### D-031 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The express and prisma advisories are fixed with `npm audit fix` plus two `package.json` `overrides`: `qs` → `6.16.2` (express 4.22 pins a vulnerable `~6.15`) and `deepmerge-ts` → `^8.0.2` (used only by `@prisma/config`, the prisma CLI's config loader). `npm audit`: 30 → 4 advisories.
**Context:** User request: fix the npm audit warnings in express's and prisma's dependencies.
**Reasoning:** The upstream fixes need express 5 or prisma 7, both breaking (prisma is pinned to v6). The overrides are minor/major bumps of leaf libraries; `prisma validate`, `prisma migrate diff`, the test suite, build and a server boot with a bracket query string all pass.
**Rejected:** `npm audit fix --force` (installs prisma 7, vite 8, vitest 5 — breaking); express 5 migration (scope).
**Tradeoff accepted:** 4 advisories remain, all dev-only tooling: `tinypool`/`@vitest/mocker` (vitest 2), `esbuild` (vite 5 dev server), `minimatch` (eslint 8). Fixing them needs major upgrades of vitest, vite and eslint. `deepmerge-ts` 8 is outside `@prisma/config`'s declared range — if a prisma CLI command misbehaves, drop that override first.
**Revisit if:** prisma 7 or express 5 is adopted (remove the overrides), or a dev-tooling major upgrade pass happens.

### D-030 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Funds outside `FUND_REGISTRY` (Stage 2's `APEX CAPITAL`) are retired. Every active-fund query uses `activeFundsWhere(worldId)` (`server/worldCore.ts`): load, peak-NAV marking, liquidation, `/world/state`, `/world/funds/:id/trace` (404) and `/world/analytics`. A retired fund's rows (positions, decisions, liquidation) stay in the database as history and still appear in the ACTIVITY feed.
**Context:** User decision (2026-11-02): retire the leftover APEX fund. Partly supersedes D-020 ("observable and liquidatable but never decide").
**Reasoning:** No schema change and no data deletion, so it is reversible by editing the registry; the registry stays the single source of which funds exist.
**Rejected:** Deleting the fund's rows (destroys history); a `Fund.retired` column + migration (unneeded while the registry decides).
**Tradeoff accepted:** Renaming a registry fund also retires its old row (already true for deciding, D-020).
**Revisit if:** a fund must be retired while staying in the registry (add a status column).

### D-029 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** A World Director runs inside the tick loop every 10 ticks (offset 9) in one of three modes set by `DIRECTOR_MODE` (env overrides `config/game.ts`, default `rule`): `none` (never acts), `rule` (deterministic `ruleDirector`) and `jev` (the `server/providers/jev.ts` adapter, a DISABLED STUB that always proposes none and says why). The Director sees only a public `DirectorObservation` (quotes, ticks since the last event and intervention, funds alive) — never fund reasoning, positions, the scheduler or unfired events. It may pick one catalog intervention (`macro_tightening`, `macro_easing`, `sector_shock`, `sector_boom`) or none; every proposal passes `validateIntervention` (no stacking on a fired event, 60-tick cooldown, known sector), and the engine builds the event (`buildDirectorEvent`, sector impact ≤ 8%, macro ≤ 5%, id prefix `director-`) on a separate RNG stream. Every cycle writes a `DirectorDecisionLog` row (mode, kind, sector, rationale, applied, headline); an applied event is also a normal `MarketEventLog` row. Migration `20261102040000_metrics_director`.
**Context:** VISION §8 — a game master that keeps the world varied without picking winners; the user asked for none/rule Directors plus a Jev stub until Jev's API details are supplied.
**Reasoning:** A fixed catalog of sector/macro moves means the Director cannot move one stock or target a fund. Validation is shared by every mode, so a future model Director inherits the same limits. Logging every cycle (including none) makes the modes comparable in ANALYTICS.
**Rejected:** Letting the rule Director stand in for `jev` (would blur the experiment); free-form model-written events (unbounded impact); running the Director outside the tick (unneeded while it is synchronous-cheap).
**Tradeoff accepted:** The Director runs under the world lock. A real Jev call is a network call and MUST move outside the lock (decide outside, validate and apply inside, as funds do) before the stub is replaced; Jev spend must be metered separately from the funds (VISION §12).
**Revisit if:** Jev's API contract arrives; the rule Director's cadence makes the world too eventful; per-fund targeting is ever proposed (reject it).
**Recalibrated 2026-11-02 (Stage 8):** the original thresholds never fired (0 interventions in 5000 ticks: ambient events every ~5 ticks, prices 7–14% from their anchor). Now: quiet = 10 ticks since a MAJOR event (|impact| ≥ 5%, `isMajorEvent`), calm < 9%, hot > 14%, run-up ≥ 3.5% mean change from anchor — ~30 interventions per 5000 ticks, measured by `simulateWorld`.

### D-028 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Evaluation metrics are pure engine functions (`packages/engine/src/metrics.ts`: `seriesMetrics` → total return, max drawdown, volatility, Sharpe; `concentration` → largest share, HHI; `eventMetrics` → count, by type, type diversity, mean |impact|, extremes), total on every input (null, never NaN). Per-fund NAV is persisted as `FundNavSnapshot` rows on every snapshot tick (every 3 ticks). `GET /world/analytics` aggregates snapshots, positions, decision sources, `LlmCallLog` outcomes/tokens/cost/latency, tool calls, the last 500 events and Director stats, and the pure `buildAnalytics` (`server/analyticsCore.ts`) turns them into per-fund financial and AI-systems metrics (fallback rate = of the decisions where the model was due, the share it did not make: budget, busy, or a call with no decision; failure rate, cost per model decision, latency, tools per call, turnover), world survival, and a list of honest limitations shown in the ANALYTICS view, refetched at most every 15 s (`ANALYTICS_POLL_MS`).
**Context:** VISION §11 — financial metrics, AI-systems metrics and world metrics, with limitations stated.
**Reasoning:** Snapshots give a NAV series without replaying the market; pure builders keep the public shape testable. Showing the limitations next to the numbers prevents reading one run as a benchmark.
**Rejected:** Recomputing NAV history from MarketTick snapshots on request (expensive, couples analytics to snapshot format); annualising Sharpe (no simulated calendar).
**Tradeoff accepted:** Sharpe and volatility are per 3-tick snapshot and not annualised; one world gives no baselines or confidence intervals; `FundNavSnapshot` grows unbounded (about 1 row per fund per 15 s).
**Revisit if:** experiment worlds arrive (baselines, multiple seeds), or snapshot volume needs pruning/downsampling.

### D-027 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** The client is an observation terminal with four live views — WORLD (market, chart, news, fund cards), FUNDS (one row per fund), FUND DETAIL (mandate/strategy, book, memory, and every recent decision expandable to its model call and tool calls) and ACTIVITY (merged feed of decisions, model calls, tool calls, events and liquidations). TIMELINE, RESEARCH LAB and ANALYTICS are listed but disabled until their stages. Two new public read-only endpoints feed the investigation views: `GET /world/funds/:id/trace` (404 unless the id is a fund of the live world) and `GET /world/activity`, built by pure, field-by-field builders in `server/observerCore.ts`; tool-call JSON is cut at `OBSERVER_JSON_MAX` (2000) characters. The store holds `view` and `selectedFundId`; the existing focus projection follows the selected fund (a focus change restarts the NAV trail), and each investigation endpoint is polled only while its view is open.
**Context:** VISION §13 — "investigate why a fund made a decision, what information it had, which tools it used and what happened afterward"; HANDOVER flagged the player-era single-fund terminal.
**Reasoning:** Traces come straight from the Stage 4 logs (`RivalDecisionLog` → `LlmCallLog` → `ToolCallLog`), so no new persistence is needed. Reusing the focus panels for FUND DETAIL avoids a second per-fund projection. Pure builders keep the public shape testable and leak-proof, like `buildWorldStatePayload`.
**Rejected:** A client router dependency (four views fit in store state; no new dep); one combined endpoint returning every fund's traces (large payload every 2.5 s); websockets (polling is still adequate at this scale, D-010).
**Tradeoff accepted:** Public observation now includes full tool inputs/outputs — still only each fund's own firewalled view (D-017). No authorization boundary yet: RESEARCH LAB (privileged configuration, VISION §13) must add one when it is built.
**Revisit if:** traces get large (paginate), or RESEARCH LAB lands (separate authenticated router).

### D-026 · 2026-11-02 · Claude Opus 5.5 (Claude Code)
**Decision:** Every registered fund has persistent memory (`AgentMemory`, migration `20261102030000_agent_memory`) of three kinds, written by pure deterministic rules in `packages/engine/src/memory.ts`: **episodic** — its own filled opens (side, size, price, thesis), closes (realized outcome) and its liquidation, prefixed `(policy)`/`(budget)`/`(busy)` when the fund's model did not make the call; **reflective** — after every 3 closes (`MEMORY_REFLECT_EVERY_CLOSES`), a summary of wins/losses, net, best/worst ticker and one rule-based observation; **relationship** — when another fund's filled open lands on a ticker this fund holds, "X shorted T while I was long" (or "crowded trade"), from that fund's public action and ticker only. The newest 40 per fund (`MEMORY_LOAD_LIMIT`) are loaded on boot and kept in process; `selectMemories` puts up to 6 into the decision prompt under "Your memory (persisted notes, not learned weights)", and the `recall_memory` tool returns filtered entries newest first. Observers see each fund's 5 newest memories (kind, tick, subject, content) in `/world/state`.
**Context:** VISION §7 (episodic, reflective, relationship memory that survives restarts) and §9 (core tool "access relevant memory").
**Reasoning:** Deterministic rules cost nothing per decision and are fully testable; the model still does the interpreting. Relationship notes use only what is already public (D-017), so agent isolation holds. Calling them "notes, not learned weights" keeps VISION §7's rule: nothing here is learning.
**Rejected:** A model-written reflection call (adds spend and an unverifiable path before cost data exists); vector search over memory (premature at tens of entries per fund); putting other funds' sizes in relationship notes (breaks isolation).
**Tradeoff accepted:** Reflections are shallow summaries; a memory write runs after the decision transaction, so a crash between them loses one memory row; closes that leave the 40-entry window before three accumulate are never reflected on; relationship notes share the 40-entry cap with the fund's own entries (revisit with more funds); `AgentMemory` is never pruned.
**Revisit if:** memory grows beyond what the prompt can hold (add retrieval by relevance), or experiments need memory ablations (gate memory per experiment config, VISION §10).

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
**Decision:** Fund identity is configuration. `config/funds.ts` (`FUND_REGISTRY`) lists three funds — STERLING & VALE (cautious value/macro, 12% max position, offset 0), HALDEN WHITMORE (aggressive event-driven short seller, 20%, offset 3), CROWN MERIDIAN (quant flow-momentum, 15%, offset 6) — each deciding every 10 ticks in its own staggered slot. `config/models.ts` (`MODEL_REGISTRY`) holds per-model pricing (USD/MTok: Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0.10/0.50) and effort. Every fund uses `claude-opus-5-5` at effort `low`, `max_tokens` 2048. A registry entry is matched to its `Fund` row **by name** (already `@@unique([worldId, name])`); missing registry funds are upserted on load; funds outside the registry (Stage 2's `APEX CAPITAL`) stay observable and liquidatable but never decide (superseded by D-030: they are retired). The public payload carries each fund's `profile` (key, personality, mandate, strategy, model) or `null`.
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



