# Stage 7 — Metrics, Analytics and the World Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Measure every fund (financial, AI-systems) and the world, show it in an ANALYTICS view, and add a World Director with three modes — none, deterministic rule-based, and a disabled Jev adapter stub.

**Architecture:** Pure engine modules `metrics.ts` (series and event statistics) and `director.ts` (observation → bounded intervention → validated → engine-built event). The server snapshots every fund's NAV with the market snapshot, runs the director on its own cadence, logs every director decision, and serves `GET /world/analytics` from a pure builder. The client adds an ANALYTICS view.

**Tech Stack:** TypeScript, Vitest, Prisma 6 (one new migration), React/Zustand. No new deps.

**Spec:** `docs/VISION.md` §8 (Jev, three Director configurations, no-intervention allowed, never-list), §11 (metrics), §12 (track Jev separately), §13 view 7.

## Global Constraints
- The Director sees only public conditions: quotes, fired events, aggregate fund survival. Never fund reasoning, positions, the event scheduler or unfired events.
- The Director picks from a fixed catalog; the deterministic engine builds and applies the event; it never targets one stock's price, never runs in a tick where another event fired, and respects `DIRECTOR_COOLDOWN_TICKS`.
- Jev stays disabled until the user supplies API details; mode `jev` without a working adapter behaves as `none` and says so.
- Metrics are labelled honestly: per-snapshot Sharpe (not annualised), one world (no confidence intervals yet).

## Review Focus
1. Director never acts when an event already fired that tick, during cooldown, or in a stressed market.
2. Validation rejects unknown kinds and sectors not in the market.
3. Metrics on empty / single-point / flat series return null or 0, never NaN/Infinity.
4. Analytics payload exposes no fund reasoning beyond what /world/state already shows.
5. NAV snapshots are written only on snapshot ticks.

---

### Task 1: Engine metrics + director
`packages/engine/src/metrics.ts`: `seriesMetrics(navs, startingCapital) → { totalReturn, maxDrawdown, volatility, sharpe }` (null where undefined), `concentration(exposures) → { largestShare, hhi }`, `eventMetrics(events) → { count, byType, typeDiversity, meanAbsImpact, extremeCount }`.
`packages/engine/src/director.ts`: `DIRECTOR_INTERVENTIONS`, `DirectorObservation`, `DirectorIntervention`, `observeWorld(...)`, `ruleDirector(obs)`, `validateIntervention(p, obs)`, `buildDirectorEvent(i, state, rng)`.
Config: `DIRECTOR_MODE`, `DIRECTOR_EVERY_TICKS`, `DIRECTOR_OFFSET`, `DIRECTOR_COOLDOWN_TICKS`, `DIRECTOR_QUIET_TICKS`, `DIRECTOR_CALM_ABS_CHANGE`, `DIRECTOR_HOT_ABS_CHANGE`.

### Task 2: Persistence + world loop
Migration `20261102040000_metrics_director`: `FundNavSnapshot` (fundId, tickCountAt, nav, grossExposure), `DirectorDecisionLog` (tickCountAt, mode, kind, sector, rationale, applied, eventHeadline). World loop writes NAV snapshots on snapshot ticks, runs the director (`resolveDirectorMode`, `server/providers/jev.ts` stub), applies a validated intervention through `applyEvent`, logs it as a market event too.

### Task 3: Analytics endpoint
`server/analyticsCore.ts` `buildAnalytics(input)`; `GET /world/analytics`.

### Task 4: ANALYTICS view
Store `analytics` polled only in that view; `AnalyticsView.tsx`; nav item enabled.

### Task 5: Docs, review, merge
D-028 (metrics), D-029 (director + Jev stub), ROLLBACK, FLOW, ARCHITECTURE, HANDOVER, TEST_CHECKLIST, FEATURE-011.
