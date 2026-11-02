# Execution Flow

## Server world tick (the world moves unattended)
Entry: `server/world.ts → startWorldLoop()` → `setInterval(5s)` → `ensureLiveWorld()` → `withWorldLock(() => tickWorld(w))`

1. `ensureLiveWorld()` (first call only): find the `World` row named `live`, or create it with `resolveWorldSeed(null, env.WORLD_SEED, WORLD_SEED)`. An existing row keeps its seed; a different `WORLD_SEED` env logs a warning (D-018). Upsert every `FUND_REGISTRY` fund missing from the world (`missingRegistryFunds`, matched by name, $10M each). Rebuild from the latest `MarketTick.snapshotJson` via `parseWorldSnapshot` (corrupt → throws, the tick is skipped and logged) then `addMissingCompanies`, or bootstrap `createInitialMarket()` + `initialScheduler()`. Build one `Agent` per fund whose name is in the registry (`liquidated` from `Fund.liquidated`); other funds are observed only.
2. `tickMarket(market, seed)` → `maybeFireScriptedEvent`/`generateEvent` → `applyEvent`
3. `trackPeakNav(w)` — compute NAV for every fund at new prices; update `Fund.peakNav` if a new all-time high
4. `liquidateFunds(w)` — for **every** non-liquidated fund with open positions: reconstruct the engine Fund, `checkLiquidation`. If `atRisk`: force-close all positions at market, `Fund.liquidated = true`, `deriveCauseOfDeath`, `LiquidationLog` (`rivalContext: null`) — one transaction. If the fund has an agent, `agent.liquidated = true`.
5. Event fired? → `MarketEventLog` row
6. `tickCount % 3 === 0`? → `MarketTick` row (`snapshotJson`)
7. For each agent: `shouldFundDecide(tickCount, agent.pending, agent.liquidated, every, offset)` (its own slot, one call in flight per fund, never when liquidated) → fire `decideFund(w, agent)` non-blocking
8. `decideFund`: `buildDecisionInput` → `makeLLMDecision(input, {url, headers}, brainFor(profile))` or `decideByPolicy(profile, input)` (no key) — OUTSIDE the lock → `enforceRiskLimit` → inside `withWorldLock`: drop the decision if the fund was liquidated meanwhile; else `applyTrade` → `applyRivalDecision` → persist in ONE transaction: Fund.cash + added/removed Positions + `RivalDecisionLog` row

Assumptions: single server process (the in-memory world is truth between snapshots); a rebuild can lose ≤2 ticks of drift.
Side effects: Postgres writes; one Anthropic call per fund decision (when key present) — ≈ 3 funds × one per 10 ticks.
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

## LLM call with fallback (server only)
Entry: `packages/engine/src/rivalLLM.ts → makeLLMDecision(input, endpoint, brain)` — `endpoint` is required; the only caller is `server/world.ts`, which passes each fund's brain (`buildFundSystemPrompt(profile)`, `profile.model`, effort, `decideByPolicy` fallback)

1. Build body (`brain.model` — `claude-opus-5-5` by default — `max_tokens: 2048`, `output_config.effort`, `brain.system`, user message from `buildRivalUserMessage`)
2. `fetch(endpoint.url)` — server only: direct Anthropic URL with `x-api-key` header (the endpoint is a required argument; the browser proxy was removed in Stage 1)
3. `stop_reason === 'refusal'` → fallback; `extractText` (first text block, skipping thinking blocks) → `stripFences` (```json …```) → `firstJsonObject` → `JSON.parse` → `isRivalDecision` guard
4. ANY failure (HTTP !ok, refusal, no text, no JSON, wrong shape, network) → `catch` → **`brain.fallback(input)`** (the fund's policy) — the world never stalls
5. Without a key: server skips the call and uses `decideByPolicy` directly

Assumptions: the fallback policy returns a valid, executable decision; the server clamps every decision with `enforceRiskLimit`.
Side effects: one API call per fired decision (gated upstream).
Fragile: if a model ID in `config/models.ts` is retired, every call 404s and the funds silently play their policies — check the console warning.
