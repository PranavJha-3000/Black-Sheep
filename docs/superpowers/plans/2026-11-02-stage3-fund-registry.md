# Stage 3 — Fund Registry Implementation Plan

> Executed inline under the standing approval of 2026-11-02 (autonomous Stages 3–7; merge + push after review).

**Goal:** Replace the single contrarian rival with a registry of three distinct AI hedge funds (VISION §6), each with its own identity, mandate, model, risk limit, decision cadence and deterministic rule-based fallback, trading a ~10-company market (VISION §15).

**Architecture:** Fund identity is configuration (`config/funds.ts`, `config/models.ts` — literal-only). The engine gains `policies.ts` (one pure fallback policy per personality) and a per-fund system prompt. The server world holds one agent per registered fund and runs each on its own staggered cadence; the observer payload carries each fund's public profile. The client shows every fund in a compact strip.

**Spec:** `docs/VISION.md` §5, §6, §12, §14, §15.

## Global Constraints
- Engine stays pure (no I/O beyond the existing `makeLLMDecision` fetch, which Stage 4 moves server-side).
- LLM proposes, engine validates: every decision still goes through `applyRivalDecision` → `openPosition`/`closePosition`.
- One coordinated writer (`withWorldLock`); LLM calls outside the lock.
- Model IDs from the Claude API reference: default `claude-opus-5-5` for every fund (no downgrade without the user naming a model); pricing recorded per model for Stage 4 metering.
- New migration allowed (standing approval); never edit `20261102000000_init`.

## Review Focus
1. Each fund decides only on its own cadence/offset, never while its own call is pending or after its liquidation — and one fund's pending call must not block the others.
2. A fund row in the DB that is not in the registry (or a registry fund missing from the DB) must not crash boot: registry funds are created if absent; unknown funds are observed but never decide.
3. Each fallback policy returns an executable decision on an empty book, a full book, zero cash and an all-flat market.
4. Policies respect `maxPositionFraction` — no single decision sizes above it.
5. Adding companies keeps every existing scripted event and test valid.

## Tasks

### Task 1: Registry + policies (engine/config)
- `config/models.ts`: `MODEL_REGISTRY` keyed by model id → `{ provider: 'anthropic', displayName, inputUsdPerMTok, outputUsdPerMTok, effort }` for `claude-opus-5-5` (4/20), `claude-sonnet-5-5` (2/10), `claude-haiku-5-5` (0.10/0.50); `DEFAULT_FUND_MODEL = 'claude-opus-5-5'`.
- `config/funds.ts`: `FUND_REGISTRY` — `sterling-vale` (STERLING & VALE, cautious, value/macro), `halden-whitmore` (HALDEN WHITMORE, aggressive, event-driven short seller), `crown-meridian` (CROWN MERIDIAN, quant, systematic flow-momentum); each `{ key, name, personality, mandate, strategy, model, maxPositionFraction, decisionEveryTicks: 10, decisionOffset: 0|3|6 }`.
- `packages/engine/src/funds.ts`: `FundProfile` type, `FUND_PROFILES`, `getFundProfile(key)`.
- `packages/engine/src/policies.ts`: `decideByPolicy(profile, input): RivalDecision` — cautious = take profit/stop loss, else buy the deepest low-vol dip; aggressive = cover winners/stop losses, else short the most negative event or most extended gainer; quant = exit when flow reverses, else follow the strongest flow; contrarian = existing `makeRandomDecision`. Sizes `≤ maxPositionFraction × availableCash`.
- Market: 10 companies (add VOLT energy, FORGE industrial, CURA biotech, LEDG finance; `Sector` gains `energy | industrial`).
- Tests: `policies.test.ts` (each policy: empty book + flat market → hold; triggers; size cap; zero cash → hold/close only), `funds.test.ts` (3 unique keys/names, valid personalities, model in registry, distinct offsets), market has 10 companies.

### Task 2: Per-fund LLM brain
- `rivalLLM.ts`: `buildFundSystemPrompt(profile)`; `makeLLMDecision(input, endpoint, brain?)` where `brain = { system, model, effort, fallback }` (defaults keep current behaviour); model id no longer hardcoded; user message says "aggregate flow lean" (no "player").
- Tests: prompt contains name/mandate and JSON contract; request body uses `brain.model`; fallback uses `brain.fallback`.

### Task 3: Server — one agent per registered fund
- Migration `20261102010000_fund_profile`: `Fund.profileKey String?`.
- `server/worldCore.ts`: `shouldFundDecide(tickCount, pending, liquidated, every = RIVAL_DECISION_TICKS, offset = 0)`; `ObservedFund` gains `profile: { key, personality, mandate, strategy, model } | null`; `FundInput.profileKey`.
- `server/world.ts`: `World.agents: Agent[]` (`{ fundId, profile, fund, pending, liquidated }`); `ensureLiveWorld` creates missing registry funds (by name), rebuilds each; `tickWorld` fires `decideFund(w, agent)` per agent; `liquidateFunds` marks the agent; route `thinking` per agent.
- Tests: cadence with offsets; payload exposes profile for registry funds and `null` for unknown.

### Task 4: Client
- Store keeps `funds: FundSummary[]` (id, name, nav, pnlPct, liquidated, thinking, personality, model); focus stays lowest id; `seedMarket()` comes from `createInitialMarket()`.
- New `FundsStrip` component above the hero: one card per fund (name, model, NAV, P&L%, LIQUIDATED/THINKING).
- Tests: projection maps all funds into summaries.

### Task 5: Docs + review + merge
- DECISIONS D-020 (registry as config; default model), D-021 (per-personality fallback policies); ARCHITECTURE/FLOW/HANDOVER/TEST_CHECKLIST/ROLLBACK; FEATURE-007.
- Fresh opus review; fix Critical/Important; merge to main; push.
