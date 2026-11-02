# Stage 6 — Observer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the single-fund terminal into an observation interface with WORLD, FUNDS, FUND DETAIL and ACTIVITY views, where an observer can see why a fund decided, what it saw, which tools it used and what happened.

**Architecture:** Two new public read-only endpoints, `GET /world/funds/:id/trace` (decision traces with their model call and tool calls, plus the fund's memory) and `GET /world/activity` (merged feed of decisions, tool calls, events, liquidations), built by pure functions in a new `server/observerCore.ts`. The client store gains `view` and `selectedFundId`; the existing focus projection follows the selected fund so Hero/Mid/RivalPanel render it in FUND DETAIL.

**Tech Stack:** React 18, Zustand 4, Tailwind, Express 4, Prisma 6, Vitest. No new deps.

**Spec:** `docs/VISION.md` §13 (views 1–4; TIMELINE, RESEARCH LAB, ANALYTICS are later stages), §9 (log tool invocations), §15 (observation dashboard).

## Global Constraints
- Public endpoints only read; no new write path from the browser. Fields are copied one by one (never spread DB rows).
- Agents never call these endpoints; agent isolation stays in `buildDecisionInput` (D-017).
- Tool-call JSON shown to observers is truncated (`OBSERVER_JSON_MAX` chars) so one huge output cannot bloat a response.
- Remove player-era copy ("YOUR POSITIONS", "RAVEN CAPITAL", "Select NOVA… and BUY").

## Review Focus
1. Unknown / non-numeric / other-world fund id on `/trace` → 404, not 500 or another world's data.
2. Switching the selected fund resets the focus NAV history (no mixed-fund sparkline).
3. A decision with no LLM call (policy) renders without a call block; a call with no decision still appears in activity.
4. Huge tool output is truncated.
5. Polling the detail/activity endpoints happens only while that view is open.

---

### Task 1: Server observer payloads
**Files:** Create `server/observerCore.ts` + `server/observerCore.test.ts`; modify `server/worldRoutes.ts`, `config/game.ts` (`OBSERVER_JSON_MAX = 2000`, `OBSERVER_TRACE_LIMIT = 20`, `OBSERVER_ACTIVITY_LIMIT = 40`).

**Produces:**
- `DecisionTrace { id, tickCountAt, at, action, ticker, reasoning, confidence, source, model, fillPrice, realizedPnL, call: CallTrace | null }`
- `CallTrace { outcome, rounds, servedBy, inputTokens, outputTokens, costUsd, latencyMs, error, tools: ToolTrace[] }`, `ToolTrace { name, ok, latencyMs, input: string, output: string }` (JSON strings, truncated)
- `FundTracePayload { fundId, decisions: DecisionTrace[], memory: ObservedMemory[] }` via `buildFundTrace(fundId, rows, memory)`
- `ActivityItem { kind: 'decision' | 'tool' | 'event' | 'liquidation', at, tickCountAt, fundName: string | null, text: string, detail: string | null }`, `ActivityPayload { items }` via `buildActivity(input)` — newest first, capped.
- Routes: `GET /world/funds/:id/trace` (404 when the id is not a fund of the live world), `GET /world/activity`.

Tests: trace field allow-list (no worldId/llmCallId leak), call null for policy rows, truncation, activity merge order + cap + tool text.

### Task 2: Client store — views and selected fund
**Files:** `src/store/gameStore.ts`, `src/store/stateMapper.ts` + test.
- `view: 'world' | 'funds' | 'fund' | 'activity'`, `selectedFundId: number | null`, `setView(v)`, `openFund(id)`, `trace: FundTracePayload | null`, `activity: ActivityPayload | null`.
- `projectState(raw, prev, focusId?)` focuses `focusId` when that fund exists, else the current default; `ProjectionPrev.focusFundId` — a focus change resets `navHistory`.
- `poll` fetches `/world/funds/:id/trace` only in `fund` view and `/world/activity` only in `activity` view.
Tests: focus follows `focusId`; unknown focusId falls back; focus change resets navHistory.

### Task 3: Views
**Files:** `src/components/Terminal.tsx` (nav + view switch, BLACK SHEEP branding), new `WorldView.tsx`, `FundsView.tsx`, `FundDetailView.tsx`, `ActivityView.tsx`; `Mid.tsx`, `TopBar.tsx` copy.
- WORLD: ticker, chart, market events, funds strip.
- FUNDS: one row per fund (name, personality, model, NAV, return, status, spend, last action); click → FUND DETAIL.
- FUND DETAIL: mandate/strategy, Hero/Mid/RivalPanel for the selected fund, memory list, decision traces with expandable tool calls.
- ACTIVITY: the feed.
Verify: typecheck, lint, build; Vite dev renders each view with the server down (empty states, no uncaught errors).

### Task 4: Docs, review, merge
D-027, FLOW (observer endpoints), ARCHITECTURE, HANDOVER, TEST_CHECKLIST, FEATURE-010, ROLLBACK.
