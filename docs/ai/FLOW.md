# Execution Flow

## Server world tick (the world moves unattended)
Entry: `server/world.ts → startWorldLoop()` → `setInterval(5s)` → `ensureLiveWorld()` → `withWorldLock(() => tickWorld(w))`

1. `ensureLiveWorld()` (first call only): find the `World` row named `live`, or create it with `resolveWorldSeed(null, env.WORLD_SEED, WORLD_SEED)`. An existing row keeps its seed; a different `WORLD_SEED` env logs a warning (D-018). Upsert every `FUND_REGISTRY` fund missing from the world (`missingRegistryFunds`, matched by name, $10M each). Rebuild from the latest `MarketTick.snapshotJson` via `parseWorldSnapshot` (corrupt → throws, the tick is skipped and logged) then `addMissingCompanies`, or bootstrap `createInitialMarket()` + `initialScheduler()`. Build one `Agent` per fund whose name is in the registry (`liquidated` from `Fund.liquidated`); other funds are observed only.
2. `tickMarket(market, seed)` → `maybeFireScriptedEvent`/`generateEvent` → `applyEvent`
3. `trackPeakNav(w)` — compute NAV for every fund at new prices; update `Fund.peakNav` if a new all-time high
4. `liquidateFunds(w)` — for **every** non-liquidated fund with open positions: reconstruct the engine Fund, `checkLiquidation`. If `atRisk`: force-close all positions at market, `Fund.liquidated = true`, `deriveCauseOfDeath`, `LiquidationLog` (`rivalContext: null`) — one transaction. If the fund has an agent, `agent.liquidated = true` and a liquidation episode is remembered.
5. World Director (D-029): `DIRECTOR_MODE != none` and `tickCount % 10 === 9` → `runDirector`: `observeWorld` (public conditions only; the quiet clock counts major events, |impact| ≥ 5%) → `ruleDirector` or `proposeWithJev` (stub: none) → `validateIntervention` → `buildDirectorEvent` (separate RNG) → `applyEvent`; one `DirectorDecisionLog` row per cycle
6. Each fired event (scheduled/random and Director) → `MarketEventLog` row; `director.lastEventTick` updated for major events
7. `tickCount % 3 === 0`? → `MarketTick` row (`snapshotJson`) + one `FundNavSnapshot` per fund (NAV, gross exposure from `trackPeakNav`'s marks)
8. For each agent: `shouldFundDecide(tickCount, agent.pending, agent.liquidated, every, offset)` (its own slot, one call in flight per fund, never when liquidated) → fire `decideFund(w, agent)` non-blocking
9. `decideFund`: `buildDecisionInput` + `memory: agent.memory` → `chooseDecision` (see "Fund decision cycle") OUTSIDE the lock → `enforceRiskLimit` → inside `withWorldLock`: drop the decision if the fund was liquidated meanwhile; else `applyTrade` → `applyRivalDecision` → persist in ONE transaction: Fund.cash + added/removed Positions + `RivalDecisionLog` row (`source`, `model`, `llmCallId`) → `rememberDecision` (see "Agent memory")

Assumptions: single server process (the in-memory world is truth between snapshots); a rebuild can lose ≤2 ticks of drift.
Side effects: Postgres writes; at most one Anthropic decision (≤ 4 rounds) per fund slot, only with a key, a material change and budget headroom.
Fragile: Express 4 async routes need `wrap()`; the clock keeps running through tick errors (logged, not thrown).
Watch: a liquidated fund never decides again; a second server process against the same DB would double-tick the world.

## Observer state (`GET /world/state`)
Entry: `server/worldRoutes.ts` → `ensureLiveWorld()` → `buildWorldStatePayload` (`server/worldCore.ts`)

1. No auth. Load the world's funds (id asc), each fund's open positions, latest `RivalDecisionLog`, and latest `LiquidationLog.cause` (only when liquidated); the last 10 `MarketEventLog` rows.
2. `thinking` = the fund's agent is pending and not liquidated; `profile` = its registry entry (public fields) or `null`.
3. `buildWorldStatePayload` copies only listed fields: `world {name, seed, tickCount, timestamp}`, company quotes, funds (NAV ≥ 1, exposures, positions with signed pnl, last decision), `flow` (15-tick net flow per ticker), recent events. No scheduler, RNG state or unfired events.
4. Client: `gameStore.poll()` every 2.5s → `projectState` focuses `funds[0]` (lowest id) and maps every fund into `funds` (FundsStrip); an empty world projects a seed fund (`fundId: null`).

Assumptions: observers are humans; agents never call this.
Side effects: reads only.
Fragile: every field added to the payload is public — add to `buildWorldStatePayload` deliberately, and keep its leak test green.

## Fund decision cycle (server only)
Entry: `server/world.ts → decideFund(w, agent)` → `chooseDecision(w, agent, input)`

1. No `ANTHROPIC_API_KEY`, or `shouldRivalReconsider(input, agent.lastLlmInput)` sees no material change → `decideByPolicy` (`source: 'policy'`).
2. `ledger.reserve(fundId, profile.dailyBudgetUsd, estimateCallCostUsd(...), now)` — null when the fund's daily budget, the global daily budget or the concurrency cap would be breached → `decideByPolicy` (`source: 'budget'`, or `'busy'` when the cap is full).
3. `agent.lastLlmInput = input`; `runDecisionLoop(createMessage, {model, effort, system: buildFundSystemPrompt(profile), user: buildRivalUserMessage(input), maxRounds: 4, maxTokens: 4096, runTool})` — `runTool` = pure `runFundTool(name, args, input, profile)`. Each round: `client.beta.messages.create` (fallback beta, `fallbacks: 'default'`); sum usage, price by `res.model`; `refusal` → stop; valid `submit_decision` → decided; no tool calls → parse text JSON or stop (`max_tokens`/`no_decision`); else echo the assistant turn, answer every tool call with a `tool_result` (`is_error` on failure); nudge before the final round; round cap → stop. SDK error → `error`. Never throws.
4. `ledger.settle(reservation, loop.costUsd, now)`; `logLlmCall` writes `LlmCallLog` + nested `ToolCallLog` rows (never throws; returns the id or null).
5. Decision present → `source: 'llm'`, `model: loop.servedBy`; absent → policy with the call id attached.

Assumptions: one server process (the ledger is in-memory, re-seeded on boot from today's `LlmCallLog`).
Side effects: provider calls (billed), `LlmCallLog`/`ToolCallLog` writes.
Fragile: if a model ID in `config/models.ts` is retired every call errors and funds play policies — check `LlmCallLog.outcome = 'error'`. The cost estimate assumes `DECISION_PROMPT_TOKENS_ESTIMATE` (3000) input tokens per round.

## Agent memory (server only, D-026)
Entry: `server/world.ts → rememberDecision(w, agent, after)` (inside the world lock, after the decision persists) and `liquidateFunds` (liquidation episode)

1. `episodeFromDecision(after, nav, tick)` — null for holds and unfilled trades (nothing is remembered).
2. A close episode → `reflect([...agent.memory, episode], tick)` — a reflection once 3 closes accumulate since the last one.
3. `remember(w, agent, entries)` — append to `agent.memory` (cap 40), `prisma.agentMemory.createMany`; errors are logged, never thrown.
4. For every other live agent: `relationshipNote(other.fund.positions, agent.profile.name, after.lastDecision, tick)` — only when the move is a filled open on a ticker that fund holds.
5. Next decision: `buildRivalUserMessage` shows `selectMemories(memory, 6)`; the `recall_memory` tool reads the same array.
6. Boot: `loadMemory(fundId)` — the newest 40 rows, oldest first.

Assumptions: one server process (memory is cached in process).
Side effects: `AgentMemory` writes; no provider calls.
Fragile: memory text is shown verbatim to the model and to observers — keep it free of other funds' sizes (D-017).

## Observer investigation (`GET /world/funds/:id/trace`, `GET /world/activity`, D-027)
Entry: `server/worldRoutes.ts` → `ensureLiveWorld()` → pure builders in `server/observerCore.ts`

1. `/funds/:id/trace`: id must be digits and a fund of the live world, else 404. Load the newest 20 `RivalDecisionLog` rows with `llmCall` → `toolCalls` (id order); `buildFundTrace` copies listed fields, nests `call` (null for policy decisions), truncates tool JSON, adds the agent's memory newest first.
2. `/activity`: the newest 40 decisions, model calls (with tool calls), market events and liquidations of the live world → `buildActivity` merges them newest first and caps at 40.
3. Client: `gameStore.poll()` fetches `/world/state` always, the trace only in FUND DETAIL, the activity feed only in ACTIVITY; `projectState(raw, prev, selectedFundId)` focuses the selected fund.

Assumptions: observers are humans; agents never call these routes.
Side effects: reads only.
Fragile: every field added to a builder is public; keep `observerCore.test.ts`'s field allow-list green.

## Research Lab (`/lab`, D-032, D-033, D-038..D-040)
Entry: `server/labRoutes.ts`; runner `server/experiments.ts → startExperimentRunner()` (started beside the world loop in `server/index.ts`)

1. `POST /lab/experiments`: `checkLabToken(header, LAB_ADMIN_TOKEN)` → 503 if unset / 401 → `parseExperimentRequest` (name, one variable incl. `brains`, 2–6 distinct values, base funds/director/cadence/ticks ≤ 5000, 1–10 distinct seeds, optional `budgetUsd` ≤ 25; any model brain needs `budgetUsd` and `ANTHROPIC_API_KEY`) → 400 → `Experiment` row `queued` with `specJson` + `experimentManifest` + `hasModelBrains` → 201 `{id}`. With `?dryRun=1` the same validation returns `{estimateUsd}` (worst case) and stores nothing.
2. Runner: on start, `running` rows with `hasModelBrains` → `failed` (`interrupted by restart`, no second payment) and the rest → `queued`. Every 2 s, if idle: oldest `queued` → claim (`updateMany` where still queued) → re-validate the stored spec → `runExperimentSpec`: for each arm (`expandArms`) and seed, `simulateWorldAsync` (the live tick's engine calls; same-tick deciders read the pre-trade market; policy funds decide inline, model funds via `makeExperimentDecide`: reconsider gate → reserve worst-case cost → `runDecisionLoop` → settle actual cost; no decision → policy with `source: 'fallback'`; a call that could exceed `budgetUsd` throws `BudgetExhausted` → row `failed`, `budget exhausted at $X.XX`) then `setImmediate` yield. The runner owns the budget: after every `llm`/`fallback` decision it writes `Experiment.costUsd` = spend so far, and any failure writes the final spend (D-042). Every decision is buffered and `createMany`'d into `ExperimentDecision` once per run (and flushed on failure). → `compareArms` (mean return and paired Δ vs baseline with bootstrap CI, sign-test p, Holm-adjusted p, fallback rate, mean cost) + downsampled series + per-run navs/events/sources/cost + digests → `done` with a manifest recomputed at run time (or `failed` with the error). Policy-only digests equal the synchronous `simulateWorld` ones.
3. `GET /lab/experiments` (newest 50 summaries; summary columns only), `GET /lab/experiments/:id` (spec, manifest, result without per-run `events` (D-042); corrupt JSON → null; 404). `GET /lab/experiments/:id/runs/:arm/:seed` (public): 404 unless the experiment is `done` and the run exists in its result with navs and events (legacy runs 404); reads that run's `ExperimentDecision` rows (cap `EXPERIMENT_REPLAY_MAX_DECISIONS` = 2000, `truncated: true` beyond) and returns decisions, exact `navTicks`, navs and events.
4. Client: `gameStore` fetches the list and the open experiment only in RESEARCH LAB, at most every 5 s; a detail for a deselected experiment is dropped; `createExperiment(body, token)` sends the token with that request only; `estimateExperiment` calls the dry run (debounced, only with a token) for the form's estimate line.

Assumptions: one server process (one runner). Experiment worlds share nothing with the live world.
Side effects: CPU on the server process (policy runs ≈ 42 ms per 5000-tick run before D-038; the async path ≈ 113 ms per 5000-tick 3-fund run, final review measurement); one `Experiment` row plus up to ticks × funds × arms × seeds `ExperimentDecision` rows; paid provider calls for model brains, only through the lab runner.
Fragile: every field of `ExperimentDetail` is public.

## Experiment memory and behaviour (D-043, D-044)
Entry: `packages/engine/src/experiment.ts`, async loop.
1. Per tick: each fund proposes (policy or model brain, the model seeing `f.memory`), `enforceRiskLimit` produces the applied decision, `clamped = !sameDecision(proposed, enforced)`, and `applyDecisions` records a `TrailStep`.
2. After decisions are applied, `updateSimMemory(funds, decided, tick, arm.memory ?? 'none', markNav)` writes episodes and reflections into `SimFund.memory` for model-backed funds only. Mode `none` returns immediately; policy funds are skipped.
3. Wherever `navs` is pushed, `grossPct` is sampled too. `summarize` calls `computeBehaviour(trail, gross, shocks, trades)` and drops the gross series.
4. `GET /lab/experiments/:id` returns `arms: compareArms(...)` computed at read time, so each fund's `behaviour` (mean + bootstrap CI over seeds, nulls skipped) is present for new experiments and missing for old ones (the UI shows an em dash).

## Leaderboard, chronicle and replay (`/lab/leaderboard`, TIMELINE, D-041)
Entry: `server/labRoutes.ts` → `buildLeaderboard` (`server/leaderboardCore.ts`); client `TimelineView.tsx` / `RunReplay.tsx`

1. `GET /lab/leaderboard` (public): one `aggregate` (count, max id) of `done` `brains` experiments keys an in-memory cache; on a key change load those rows → `buildLeaderboard` → `{leaderboard: LeaderboardRow[]}`. Subject funds = funds whose brain is a model in some arm; each model result is paired by fund and seed with the same experiment's all-policy baseline arm only; model runs with zero `llm` decisions are dropped; `fallbackRate` = Σ fallback / Σ (llm + fallback); `insufficient` when pairs < 5 (runs < 5 for Policy); run cost attributed to the subject fund; legacy or malformed rows skipped.
2. TIMELINE: shows the leaderboard and the run cards of the newest `CHRONICLE_MAX_EXPERIMENTS` (10) done experiments; `chronicle.ts` builds the cards (legacy runs without navs skipped; brains looked up by arm label).
3. Replay: a full page load on `#/timeline/<id>/<arm>/<seed>` routes to `RunReplay`, which fetches `GET /lab/experiments/:id/runs/:arm/:seed`. The x axis is the exact `navTicks` (raw nav point k at tick 3·(k+1)); the decision feed is synced to the cursor; play/pause steps one point per 150 ms; the footer shows the manifest hashes.

Assumptions: one model fund per arm for exact cost attribution.
Side effects: reads only.
Fragile: every request loads all qualifying `resultJson` rows. No `hashchange` routing (changing the hash after load does nothing). Decisions after the last nav tick are hidden; decisions are capped at `EXPERIMENT_REPLAY_MAX_DECISIONS` = 2000. The digest shows '—' for experiments outside the newest chronicle set.

## Analytics (`GET /world/analytics`, D-028)
Entry: `server/worldRoutes.ts` → `ensureLiveWorld()` → `buildAnalytics` in `server/analyticsCore.ts`

1. Per fund: newest 2000 `FundNavSnapshot` NAVs (reversed to oldest first), positions (open ones → signed exposure at current price; all → opened notional), `RivalDecisionLog` grouped by source, `LlmCallLog` grouped by outcome with token/cost/latency sums, `ToolCallLog` count.
2. World: last 500 `MarketEventLog` rows; `DirectorDecisionLog` grouped by kind and applied; the configured Director mode.
3. `buildAnalytics` → financial metrics (`seriesMetrics`, `concentration`, turnover), AI-systems metrics (null when no data), event metrics, survival, notes.
4. Client: `gameStore.poll()` fetches `/world/analytics` only while ANALYTICS is open.

Assumptions: one world; per-fund queries run fund by fund (N funds × 5 queries).
Side effects: reads only.
Fragile: every field in `AnalyticsPayload` is public.
