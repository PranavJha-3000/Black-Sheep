# Execution Flow

## Server world tick (the world moves unattended)
Entry: `server/world.ts → startWorldLoop()` → `setInterval(5s)` → `ensureLiveWorld()` → `withWorldLock(() => tickWorld(w))`

1. `ensureLiveWorld()` (first call only): find the `World` row named `live`, or create it with `resolveWorldSeed(null, env.WORLD_SEED, WORLD_SEED)`. An existing row keeps its seed; a different `WORLD_SEED` env logs a warning (D-018). Upsert every `FUND_REGISTRY` fund missing from the world (`missingRegistryFunds`, matched by name, $10M each). Rebuild from the latest `MarketTick.snapshotJson` via `parseWorldSnapshot` (corrupt → throws, the tick is skipped and logged) then `addMissingCompanies`, or bootstrap `createInitialMarket()` + `initialScheduler()`. Build one `Agent` per fund whose name is in the registry (`liquidated` from `Fund.liquidated`); other funds are observed only.
2. `tickMarket(market, seed)` → `maybeFireScriptedEvent`/`generateEvent` → `applyEvent`
3. `trackPeakNav(w)` — compute NAV for every fund at new prices; update `Fund.peakNav` if a new all-time high
4. `liquidateFunds(w)` — for **every** non-liquidated fund with open positions: reconstruct the engine Fund, `checkLiquidation`. If `atRisk`: force-close all positions at market, `Fund.liquidated = true`, `deriveCauseOfDeath`, `LiquidationLog` (`rivalContext: null`) — one transaction. If the fund has an agent, `agent.liquidated = true` and a liquidation episode is remembered.
5. Event fired? → `MarketEventLog` row
6. `tickCount % 3 === 0`? → `MarketTick` row (`snapshotJson`)
7. For each agent: `shouldFundDecide(tickCount, agent.pending, agent.liquidated, every, offset)` (its own slot, one call in flight per fund, never when liquidated) → fire `decideFund(w, agent)` non-blocking
8. `decideFund`: `buildDecisionInput` + `memory: agent.memory` → `chooseDecision` (see "Fund decision cycle") OUTSIDE the lock → `enforceRiskLimit` → inside `withWorldLock`: drop the decision if the fund was liquidated meanwhile; else `applyTrade` → `applyRivalDecision` → persist in ONE transaction: Fund.cash + added/removed Positions + `RivalDecisionLog` row (`source`, `model`, `llmCallId`) → `rememberDecision` (see "Agent memory")

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
