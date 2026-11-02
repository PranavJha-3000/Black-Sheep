# Stage 4 — Decision Cycle, Tools & Cost Metering Implementation Plan

> Executed inline under the standing approval of 2026-11-02 (autonomous Stages 3–7; merge + push after review).

**Goal:** Make every fund decision a metered, budgeted, auditable cycle (VISION §6 decision cycle, §9 core tools, §12 cost): provider calls move out of the pure engine into a server adapter on the official `@anthropic-ai/sdk`; funds research through read-only tools before deciding; every call is priced, budget-reserved and logged; every decision records where it came from.

**Architecture:** The engine keeps only pure pieces — prompt/user-message builders, the decision schema, response parsing, tool definitions and pure tool handlers over `RivalDecisionInput`. The server owns I/O: `server/providers/anthropic.ts` (SDK adapter), `server/budget.ts` (pure ledger: reserve → settle, per-fund + global daily limits, concurrency cap), and `decideFund` orchestration. New `LlmCallLog` / `ToolCallLog` tables and new `RivalDecisionLog` columns make each decision auditable.

**Tech Stack:** `@anthropic-ai/sdk` (new dependency, server-side only), Prisma migration, Vitest.

**Spec:** `docs/VISION.md` §6 (decision cycle), §9 (tools), §12 (cost), §14 invariants 5, 6, 8, 9, 10.

## Global Constraints
- Engine purity (VISION §14.10): after this stage `packages/engine` contains no `fetch` and no provider SDK import.
- LLM calls never hold the world lock (§14.5); tools read a snapshot `RivalDecisionInput`, never live state or the DB.
- Agent isolation (§14.4): tools expose only the fund's own book and public market data.
- "No agent should continue making API calls after its budget is exhausted" (§12): the reservation happens before the call; an exhausted fund uses its deterministic policy.
- Model defaults per the Claude API reference: `claude-opus-5-5`, effort `low`; no forced `tool_choice` (Opus 5.5 returns 400); check `stop_reason === 'refusal'`; opt into `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`.
- New migration allowed (standing approval); never edit applied migrations; ROLLBACK entry required.

## Review Focus
1. A budget can never be overspent by concurrent decisions: reservations count against the limit until settled, and a failed call releases its reservation.
2. The tool loop is bounded (max rounds) and every exit path — refusal, max_tokens, malformed tool input, unknown tool, SDK error, budget exhaustion — ends in a valid decision and a logged LlmCall row.
3. Tool outputs never include another fund's positions or cash.
4. Cost arithmetic: cache-read and cache-write tokens are priced (Opus 5.5 cache read 0.05× input; writes 1.25×), and the meter matches `usage` exactly.
5. A world with no key still runs exactly as Stage 3 (policy decisions, `source = 'policy'`, no LlmCall rows).

## Tasks

### Task 1: Pure decision pieces (engine)
- `packages/engine/src/fundTools.ts`: provider-agnostic `ToolSpec {name, description, input_schema}`; `FUND_TOOLS` = `inspect_company {ticker}`, `inspect_portfolio {}`, `calculate_risk {}`, `recent_events {ticker?}`, plus terminal `submit_decision {action, ticker?, dollarAmount?, reasoning, confidence}` (strict schemas, `additionalProperties: false`); `runFundTool(name, args, input) → { ok: boolean; output: unknown }` — pure handlers over the fund's `RivalDecisionInput` only; `parseSubmittedDecision(args) → RivalDecision | null`.
- `policies.ts`: export `maxNewPositionDollars(input, profile)` (the NAV/gross-capped size) for `calculate_risk`; `enforceRiskLimit` turns a missing/non-positive `dollarAmount` into a hold (Stage 3 deferred minor).
- `rivalLLM.ts`: drop `fetch`, `makeLLMDecision`, `LLMEndpointOptions`, `FundBrain`; keep prompt + user-message builders and `shouldRivalReconsider`; export `parseDecisionText(text) → RivalDecision | null`; the fund prompt tells the model to research with tools and finish with `submit_decision`.
- Tests: each tool's output, unknown tool / bad args → `ok:false`, isolation (outputs only reference the own book), `parseSubmittedDecision` guards, `parseDecisionText` (fenced / prose-wrapped / malformed — ported from the old makeLLMDecision tests), dollarAmount guard.

### Task 2: Budget ledger + pricing (server, pure)
- `config/models.ts`: `cacheReadMultiplier` (Opus 5.5 0.05, others 0.1), `cacheWriteMultiplier` 1.25.
- `config/game.ts`: `GLOBAL_DAILY_BUDGET_USD = 10`, `MAX_CONCURRENT_LLM_CALLS = 2`, `MAX_TOOL_ROUNDS = 4`, `DECISION_MAX_TOKENS = 4096`; `config/funds.ts`: `dailyBudgetUsd` per fund (2.00).
- `server/budget.ts`: `costOfUsage(model, usage)`; `estimateCallCostUsd(model, rounds, maxTokens, promptTokens)`; `BudgetLedger` — `seed(spentByFund, day)`, `reserve(fundId, limitUsd, estimateUsd, now) → Reservation | null` (refuses on per-fund limit, global limit or concurrency; reservations count until settled), `settle(res, actualUsd)`, `release(res)`, `spentToday(fundId)`; UTC-day rollover.
- Tests: refuses at each limit, concurrent reservations counted, release frees, settle replaces estimate with actual, day rollover resets, cost arithmetic incl. cache tokens.

### Task 3: Provider adapter + persistence + orchestration (server)
- Dependency `@anthropic-ai/sdk@^1.3.0` (D-023). `server/providers/anthropic.ts`: `runDecisionLoop(create, req) → LoopResult { decision | null, stopReason, usage, toolCalls[{name,input,output,ok,latencyMs}], rounds, latencyMs, error? }` — manual tool loop (`tool_choice` auto, strict tools, `output_config.effort`, `fallbacks: "default"` beta), ends on `submit_decision`, text JSON, refusal, max_tokens, round cap or error; `create` is injected (tests use a fake).
- Migration `20261102020000_decision_metering`: `LlmCallLog`, `ToolCallLog`, `RivalDecisionLog.source/model/llmCallId`.
- `server/world.ts` `decideFund`: material-change guard per agent (skip when nothing changed) → budget reserve (no reservation → policy, `source = 'budget'`) → `runDecisionLoop` outside the lock → settle → `enforceRiskLimit` → apply + persist decision, LlmCallLog, ToolCallLogs in the same transaction. Ledger seeded from today's LlmCallLog on load.
- `/world/state`: per fund `spend {todayUsd, dailyBudgetUsd}` and `lastDecision.source`.
- Tests: adapter loop with a fake `create` (tool round then submit; refusal; max_tokens; round cap; thrown error; unknown tool; text-only JSON), usage summed across rounds.

### Task 4: Client
- FundsStrip shows spend vs budget and last decision source (LLM / POLICY / BUDGET).

### Task 5: Docs + review + merge
- D-023 (SDK adapter + engine purity), D-024 (tools + loop bounds), D-025 (budget ledger + metering); ROLLBACK (migration + dep); FLOW/ARCHITECTURE/HANDOVER/TEST_CHECKLIST; FEATURE-008. Fresh opus review → fix → merge → push.
