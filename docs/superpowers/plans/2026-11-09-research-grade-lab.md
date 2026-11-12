# Research-Grade Lab — Roadmap + Phase 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the policy-only Research Lab into an instrument that can run model-backed, paired, budgeted experiments, show every run publicly as a replayable "chronicle" with aligned charts and confidence intervals, and export paper-ready numbers whose every value traces back to an experiment id and manifest hash.

**Architecture:** The pure engine's `stepWorld` is split into *advance → decide → apply*, so the same world loop runs synchronously with policies (unchanged digests) or asynchronously with an injected `DecideFn`. The server supplies an LLM-backed `DecideFn` built on the existing `runDecisionLoop`, metered against a hard per-experiment budget. Every decision is persisted (`ExperimentDecision`), which powers both the replay UI (TIMELINE view) and the paper exporter. Statistics (bootstrap CIs, exact sign test, Holm correction) live in a new pure `stats.ts`.

**Tech Stack:** TypeScript, Vitest, Express, Prisma 6 / Postgres, React + Zustand + Tailwind. No new dependencies.

**Spec:** `docs/VISION.md` §4 (research questions), §10 (lab, Mode B, reproducibility), §11 (metrics, CIs, baselines), §13 (TIMELINE view), §16 (reports) — plus the user's 2026-11-09 goal: "a simulation with visible and aligned results shown like napole0n.ai and a research paper published on various parameters like Emergence World and arXiv 2610.22319."

## What the references actually do (studied 2026-11-09)

| Reference | What to borrow | What to do better |
|---|---|---|
| **napole0n.ai** | Same 4 models in every battle; named scenarios ("Frontier Baseline", "The Peace Dividend") that vary one rule; a **Chronicles** archive where each battle expands to the generals' own words; a **leaderboard** ranked by wins then points, with the count of battles shown ("12 RECORDED BATTLES"). | Their ranking has no uncertainty. Ours shows n, CI, and paired wins vs a baseline. |
| **Emergence World** (blog) | Identical worlds, only the model varies; long horizon; full traces; diary quotes as qualitative evidence; per-model time-series ("cumulative crimes"). | "Ran several times", figures from "one representative run", no CIs. We pre-register, run fixed seeds, and report all runs. |
| **arXiv 2610.22319** (Gemini agents beat Minecraft) | Paper shape: setup → run narrative with timeline figure → emergent behaviours (counted by pattern matching) → verification → **cost section** (tokens, cached share, $) → limitations → responsible development. | Single run, no stats. We keep its cost and limitations honesty and add replication. |

## Roadmap (one plan per phase; only Phases 1–2 are tasked below)

| Phase | Delivers | Gate before it starts |
|---|---|---|
| **1. Model-backed experiments** | Async world loop, LLM brains per fund, hard budget, persisted decisions, CIs and p-values | Approval of this plan; one migration |
| **2. Chronicles + replay + leaderboard** | TIMELINE view (run archive + scrubber replay with reasoning), leaderboard with CIs | Phase 1 merged |
| 3. Memory ablation + behavioural metrics | `memory: none/episodic/reflective/full` arm variable; action entropy, mandate adherence, repeated-error rate, shock reaction | Own plan; metric definitions approved |
| 4. Paper pipeline + the study | `paper/PREREGISTRATION.md` committed **before** any study run; `scripts/export-paper.ts` → CSV / SVG / `.tex` tables; `paper/main.tex` in the 2610.22319 section order; the study runs | Spend approval (see cost table) |
| 5. Cross-vendor brains (gated) | GPT / Gemini / Grok brains through a fetch-based OpenAI-compatible adapter (no new dep), like Napoleon's four generals | User picks a provider (e.g. OpenRouter), supplies keys, approves spend |

Jev stays a stub until its API contract exists (unchanged open item).

### Cost guide for Phase 4 (estimates, to be replaced by Phase 1 smoke measurements)
Assumes ~12k input + 2k output tokens per decision (3 tool rounds), one model-backed "subject" fund, 1000 ticks, cadence 10 → ≤100 calls per run (the reconsider gate lowers this).

| Brain | $/decision | $/run (worst) | 20 seeds |
|---|---|---|---|
| Haiku 5.5 | ~0.002 | ~0.20 | ~4 |
| Sonnet 5.5 | ~0.044 | ~4.40 | ~88 |
| Opus 5.5 | ~0.088 | ~8.80 | ~176 |

## Global Constraints

- No new dependencies (AGENTS.md). Phase 5's adapter uses `fetch`.
- Engine stays pure: `packages/engine` imports no express/prisma/react/SDK. The LLM call is injected.
- Every async Express route goes through `wrap()`. Lab writes need `LAB_ADMIN_TOKEN` (D-033); reads are public.
- Policy-only experiments must keep **byte-identical digests** after the refactor.
- Model calls never run inside `withWorldLock`; experiment worlds never touch the live world.
- Never call an LLM from the browser. Provider key stays server-side.
- Budget: an experiment with any model brain must declare `budgetUsd` ≤ `EXPERIMENT_MAX_BUDGET_USD = 25` (new in `config/game.ts`); spend never exceeds it by more than one call's cost.
- Prisma pinned to v6. One migration in this plan (Task 4); write its rollback to `docs/ai/ROLLBACK.md` first.
- Never report a result as verified without running it; live-model behaviour stays UNVERIFIED until the user approves a keyed smoke run.
- Docs: HANDOVER log, DECISIONS (D-038…), FLOW, ARCHITECTURE, FEATURE-013 updated in Task 7.

## Review Focus

1. **Budget exhausted mid-run** → the experiment ends `failed` with error `budget exhausted at $X.XX`, decisions already written stay, no further provider call. (Task 3 test `stops before the call that would exceed the budget`.)
2. **Model returns no decision / refusal / provider error** → that decision falls back to the fund's policy, recorded with `source: 'fallback'`, and the fallback rate is shown per arm. (Task 3 test `records fallback when the loop returns no decision`.)
3. **No `ANTHROPIC_API_KEY` but a model brain requested** → create is rejected with 400 `Model brains need a provider key on the server.`; nothing queued. (Task 3 test in `labCore.test.ts`.)
4. **Server restart during a model-backed experiment** → today's runner re-queues it and reruns it, which would pay twice. Model-backed experiments are marked `failed` with `interrupted by restart` instead; policy-only ones still re-queue. (Task 4 test `does not requeue a model-backed run`.)
5. **Replay of a run with thousands of decisions** → the run endpoint caps decisions at `EXPERIMENT_REPLAY_MAX_DECISIONS = 2000` and says so in the payload (`truncated: true`); the UI shows the note. (Task 5 test `caps decisions and flags truncation`.)

---

## Phase 1 — Model-backed experiments

### Task 1: Split the world step and add the async loop

**Files:**
- Modify: `packages/engine/src/experiment.ts`
- Test: `packages/engine/src/experiment.test.ts`

**Interfaces:**
- Produces:
  - `export type FundBrain = 'policy' | ModelId` (ModelId from `config/models.ts`)
  - `ArmConfig.brains: Record<string, FundBrain>` — missing key = `'policy'`. `'brains'` appended to `EXPERIMENT_VARIABLES`.
  - `export type DecisionSource = 'policy' | 'llm' | 'fallback'`
  - `export interface DecisionRecord { tick: number; fundKey: string; source: DecisionSource; model: string | null; decision: RivalDecision; costUsd: number; inputTokens: number; outputTokens: number; latencyMs: number; toolCalls: { name: string; ok: boolean }[]; outcome: string | null }`
  - `export type DecideFn = (ctx: { fund: SimFund; input: RivalDecisionInput; tick: number }) => Promise<Omit<DecisionRecord, 'tick' | 'fundKey'>>`
  - `export async function simulateWorldAsync(arm: ArmConfig, seed: number, decide: DecideFn, onDecision?: (r: DecisionRecord) => void | Promise<void>): Promise<RunResult>`
  - `RunResult.funds[i].sources: Record<DecisionSource, number>`; `RunResult.costUsd: number`; `RunResult.events[i].tick: number`.
  - `simulateWorld(arm, seed)` keeps its signature and stays synchronous.

- [ ] **Step 1: Pin the current digest.** On `main`, before editing, run a scratch script calling `simulateWorld({ funds: ['sterling-vale','halden-whitmore','crown-meridian'], directorMode: 'rule', decisionEveryTicks: null, ticks: 600, brains: {} }, 7).digest` (omit `brains` on main). Add test `policy digests are unchanged by the async split` asserting that literal, plus the same for seed 21 with `directorMode: 'none'`.
- [ ] **Step 2: Write failing tests**
  - `simulateWorldAsync with a policy DecideFn matches simulateWorld` — same digest, same `sources` counts, for seeds 1–3.
  - `brains routes only model funds to the injected decide` — arm with `brains: { 'crown-meridian': 'claude-haiku-5-5' }` and a stub decide that returns `hold` and counts calls: stub is called only for crown-meridian; the other two have `sources.policy > 0`, `sources.llm === 0`.
  - `onDecision sees every decision in tick order` — ticks are non-decreasing; count equals Σ `decisions`.
  - `events carry their tick`.
- [ ] **Step 3: Run** `npx vitest run packages/engine/src/experiment.test.ts` → new tests FAIL (missing exports).
- [ ] **Step 4: Implement.** Extract from `stepWorld`: `advanceTick(s: SimState): void` (everything up to and including NAV snapshots) and `applyDecisions(s: SimState, decided: { f: SimFund; decision: RivalDecision }[]): void` (the trade-impact loop). `stepWorld` = advance → policy decisions → `enforceRiskLimit` → apply. `simulateWorldAsync` loops the same, awaiting `decide` per deciding fund **in registry order, sequentially**, then `enforceRiskLimit` on the returned decision (the model proposes, the risk limit disposes — same as `server/world.ts:758`). Policy funds in an async run are decided by `decideByPolicy` directly, never through `decide`. `initialSimState` copies `arm.brains` onto `SimFund.brain`.
- [ ] **Step 5: Run** the file, then `npm test` → all PASS, including the pinned digests.
- [ ] **Step 6: Commit** `feat(engine): async experiment loop with injectable fund brains`

### Task 2: Statistics — bootstrap CIs, sign test, Holm

**Files:**
- Create: `packages/engine/src/stats.ts`, `packages/engine/src/stats.test.ts`
- Modify: `packages/engine/src/experiment.ts` (`compareArms`), `packages/engine/src/experiment.test.ts`

**Interfaces:**
- Produces:
  - `bootstrapMeanCI(xs: number[], opts?: { iters?: number; alpha?: number; seed?: number }): [number, number] | null` — percentile bootstrap, defaults `iters 2000, alpha 0.05, seed 1`, uses `mulberry32` from `market.ts`; `null` when `xs.length < 2`.
  - `signTestP(wins: number, n: number): number` — exact two-sided binomial p (p=0.5), capped at 1; ties are excluded by the caller.
  - `holm(ps: number[]): number[]` — Holm-adjusted p-values in input order, monotone, capped at 1.
  - `FundArmStats.totalReturnCI: [number, number] | null`; `vsBaseline` gains `ci: [number, number] | null`, `pSign: number`, `pHolm: number` (Holm across every `vsBaseline` in the comparison).
  - `ArmComparison.fallbackRate: number | null` (fallback / (llm + fallback); null with no model brains) and `meanCostUsd: number`.

- [ ] **Step 1: Write failing tests** in `stats.test.ts`:
  - `signTestP(9, 10)` → `0.021484375`; `signTestP(5, 10)` → `1`; `signTestP(0, 0)` → `1`.
  - `holm([0.01, 0.04, 0.03])` → `[0.03, 0.06, 0.06]`.
  - `bootstrapMeanCI([2,2,2])` → `[2, 2]`; `bootstrapMeanCI([1])` → `null`; same input + seed twice → identical result; for `[1..20]` the interval contains `10.5` and `lo < hi`.
  - In `experiment.test.ts`: `compareArms reports CI and Holm-adjusted p for paired arms` — two-arm, 5-seed policy experiment: every non-baseline fund has `ci`, `0 ≤ pSign ≤ pHolm ≤ 1`.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement** `stats.ts` and extend `compareArms`. Ties (diff === 0) are dropped from the sign test's n.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(engine): bootstrap CIs, exact sign test and Holm correction for experiment comparisons`

### Task 3: The LLM brain and budget for experiments

**Files:**
- Create: `server/labBrain.ts`, `server/labBrain.test.ts`
- Modify: `server/labCore.ts` (validation, `runExperimentSpec`), `server/labCore.test.ts`, `config/game.ts`

**Interfaces:**
- Consumes: `runDecisionLoop(create, req)` and `CreateMessage` from `server/providers/anthropic.ts`; `estimateCallCostUsd` from `server/budget.ts`; `buildFundSystemPrompt`, `buildRivalUserMessage`, `shouldRivalReconsider` from `rivalLLM.ts`; `runFundTool` from `fundTools.ts`; `DecideFn` from Task 1.
- Produces:
  - `export class BudgetExhausted extends Error { spentUsd: number }`
  - `export interface ExperimentBudget { limitUsd: number; spentUsd: number }`
  - `export function makeExperimentDecide(create: CreateMessage, budget: ExperimentBudget): DecideFn` — per-fund `lastLlmInput` kept in a closure Map keyed by fund key; a new closure per run.
  - `export function estimateExperimentCostUsd(spec: ExperimentSpec): number` — worst case: Σ arms × seeds × model funds × ⌊ticks / every⌋ × `estimateCallCostUsd(model, MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE)`.
  - `ExperimentSpec.budgetUsd: number | null`.
  - `parseExperimentRequest(body, opts: { providerConfigured: boolean })` — **signature change, internal only** (one caller in `labRoutes.ts`, one in `experiments.ts`).
  - `runExperimentSpec(spec, yieldFn, deps?: { create: CreateMessage | null; onDecision?: (arm: string, seed: number, r: DecisionRecord) => Promise<void> })` returns `ExperimentResult` plus `costUsd: number` and `estimateUsd: number`.
  - `config/game.ts`: `EXPERIMENT_MAX_BUDGET_USD = 25`.

- [ ] **Step 1: Write failing tests** (`labBrain.test.ts`, stub `create`):
  - `reuses the policy when nothing material changed` — second call with identical input: `source 'policy'`, stub not called.
  - `records fallback when the loop returns no decision` — stub returns a text-only message with no JSON → `source 'fallback'`, decision equals `decideByPolicy(profile, input)`, `costUsd > 0`.
  - `stops before the call that would exceed the budget` — `limitUsd` below one estimate → throws `BudgetExhausted`, stub never called.
  - `adds actual cost to the budget` — after a decided call, `budget.spentUsd` equals the loop's `costUsd`.
  - In `labCore.test.ts`: `rejects model brains without a provider` (`providerConfigured: false` → error `Model brains need a provider key on the server.`); `requires budgetUsd for model brains` (→ `budgetUsd is required when any fund uses a model (max $25).`); `rejects unknown model ids in brains`; `policy-only spec needs no budget`.
- [ ] **Step 2: Run** `npx vitest run server/labBrain.test.ts server/labCore.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Reservation = the per-call estimate; reject if `spentUsd + estimate > limitUsd`; settle with actual `loop.costUsd`. Policy-only specs keep using the sync `simulateWorld` (no behaviour change); specs with any model brain use `simulateWorldAsync` with `makeExperimentDecide`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS / exit 0.
- [ ] **Step 5: Commit** `feat(lab): model-backed experiment brains with a hard per-experiment budget`

### Task 4: Persist decisions and per-run series

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/20261109000000_experiment_decisions/migration.sql`
- Modify: `server/experiments.ts`, `server/experiments.test.ts`, `server/labCore.ts` (`ExperimentResult.runs`)
- Modify: `docs/ai/ROLLBACK.md` (first)

**Interfaces:**
- Produces:
  - Model `ExperimentDecision { id Int @id @default(autoincrement()); experimentId Int; arm String; seed Int; tick Int; fundKey String; source String; model String?; action String; ticker String?; dollarAmount Float?; confidence Float?; reasoning String; costUsd Float; inputTokens Int; outputTokens Int; latencyMs Int; toolCallsJson String; outcome String?; @@index([experimentId, arm, seed, tick]) }` with relation to `Experiment` (`onDelete: Cascade`).
  - `Experiment.costUsd Float @default(0)`, `Experiment.hasModelBrains Boolean @default(false)`.
  - `ExperimentResult.runs[].runs[]` gains `navs: Record<string, number[]>` (downsampled to `EXPERIMENT_SERIES_POINTS`), `events: { tick; type; priceImpactPercent; director }[]`, `sources`, `costUsd`.
  - `requeueInterrupted()` re-queues only `hasModelBrains = false`; model-backed `running` rows become `failed` / `interrupted by restart`.

- [ ] **Step 1: Write the rollback** for this migration in `docs/ai/ROLLBACK.md` (drop table + two columns; result JSON is additive).
- [ ] **Step 2: Write failing tests** in `experiments.test.ts` (existing prisma mock style): `writes decisions in batches per run`, `does not requeue a model-backed run`, `records budget exhaustion as failed with spend`.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.** Generate SQL offline with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`. Buffer each run's decisions and `createMany` once per run (not per decision). On `BudgetExhausted`: status `failed`, `error: budget exhausted at $X.XX`, `costUsd` saved.
- [ ] **Step 5: Verify** `npm test`, `npm run typecheck`, `npx prisma validate`; then on `npm run db:local`: `npx prisma migrate deploy` (6/6) and `prisma migrate diff --exit-code` (no drift).
- [ ] **Step 6: Commit** `feat(lab): persist experiment decisions and per-run series (migration)`

### Task 5: Run endpoint for replay

**Files:**
- Modify: `server/labRoutes.ts`, `server/labCore.ts`, `server/labCore.test.ts`, `config/game.ts`

**Interfaces:**
- Produces:
  - `GET /lab/experiments/:id/runs/:arm/:seed` (public, `wrap()`), 404 on unknown arm/seed.
  - `export interface RunReplay { experimentId: number; arm: string; seed: number; navs: Record<string, number[]>; snapshotEveryTicks: number; events: {...}[]; decisions: DecisionRecord[]; truncated: boolean; manifest: ExperimentManifest }`
  - `export function buildRunReplay(row: ExperimentRow, arm: string, seed: number, decisions: DecisionRecord[]): RunReplay | null`
  - `config/game.ts`: `EXPERIMENT_REPLAY_MAX_DECISIONS = 2000`.
- [ ] **Step 1: Failing tests**: `buildRunReplay returns null for an unknown arm`, `caps decisions and flags truncation`, `returns the run's own navs, not the first seed's`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; boot smoke against `db:local`: `curl /lab/experiments/1/runs/<arm>/<seed>` → 200 JSON.
- [ ] **Step 5: Commit** `feat(lab): public per-run replay endpoint`

### Task 6: Lab form and results — brains, budget, CIs

**Files:**
- Modify: `src/components/ResearchLabView.tsx`, `src/store/gameStore.ts` (lab slice types only), `server/labRoutes.ts` + `server/labCore.test.ts` (dry run)

**Interfaces:**
- Consumes: Task 2/3/4 payload fields.
- [ ] **Step 1:** Form: per-fund brain select (`Policy` + every `MODEL_REGISTRY` display name); `Budget (USD)` input shown when any brain is a model; live worst-case estimate line (computed client-side from the same constants is engine duplication — instead show the server's `estimateUsd` returned from a dry-run `POST /lab/experiments?dryRun=1`, which validates and returns `{ estimateUsd }` without queuing; add test `dry run validates and does not store` in `labCore.test.ts`/route).
- [ ] **Step 2:** Results table: `return mean [CI]`, `vs baseline Δ [CI]`, `wins/pairs`, `p (Holm)`, `survival`, `fallback rate`, `cost`. Every chart for one experiment shares one y-axis domain across arms ("aligned").
- [ ] **Step 3: Verify** typecheck/lint/build; browser on `db:local`: create a policy-only 2-arm experiment and see CIs; the model-brain form path shows the estimate and is rejected without a key with the Review Focus #3 message. Screenshot.
- [ ] **Step 4: Commit** `feat(ui): lab form brains + budget; CI and Holm p in results`

### Task 7: Keyed smoke run (needs user approval) + docs

- [ ] **Step 1 (GATED — ask the user):** with their key, run one experiment: `variable: 'brains'`, values `[{}, {'crown-meridian':'claude-haiku-5-5'}]`, seeds `[1,2]`, ticks 300, `budgetUsd: 1`. Record actual $/decision, fallback rate, latency into the cost table above, replacing the estimates.
- [ ] **Step 2:** Docs: D-038 (async split + injected brain), D-039 (experiment budget + no-requeue for model runs), D-040 (stats choices: percentile bootstrap, exact sign test, Holm); FLOW, ARCHITECTURE rows for `stats.ts`, `labBrain.ts`, `ExperimentDecision`; FEATURE-013; HANDOVER log with CHANGED / WHY / VERIFY / NOT VERIFIED.
- [ ] **Step 3:** `git diff main --stat` reviewed for scope; commit `docs: Stage 9 Phase 1`.

---

## Phase 2 — Chronicles, replay and leaderboard (Napoleon-style visibility)

### Task 8: Leaderboard endpoint

**Files:** Create `server/leaderboardCore.ts` + test; Modify `server/labRoutes.ts`.

**Interfaces:**
- `GET /lab/leaderboard` (public). `export function buildLeaderboard(rows: ExperimentRow[]): LeaderboardRow[]` where `LeaderboardRow = { brain: FundBrain; displayName: string; experiments: number; runs: number; meanReturn: number | null; returnCI: [number, number] | null; survival: number; pairedVsPolicy: { wins: number; pairs: number; meanDiff: number; ci: [number, number] | null } | null; meanCostPerDecision: number | null }`.
- Rules: only `status = 'done'` and `variable = 'brains'`; **every** such experiment counts (no hand-picking); paired vs policy uses the same fund key + seed in the same experiment's policy arm. Ranked by `pairedVsPolicy.meanDiff`, then `meanReturn`; rows with `runs < 5` are listed but marked `insufficient`.
- Tests: `counts every done brains experiment`, `ignores failed and non-brains experiments`, `pairs only within the same experiment and seed`, `marks rows under 5 runs insufficient`.
- Steps: failing tests → run → implement → `npm test` → commit `feat(lab): public leaderboard with paired CIs`.

### Task 9: TIMELINE view — the Chronicles archive

**Files:** Create `src/components/TimelineView.tsx`; Modify `src/store/gameStore.ts` (`ObserverView` gains `'timeline'`, `NAV_ITEMS` Timeline → `'timeline'`, `chronicle` slice), `src/components/Terminal.tsx` (route the view).

- Archive list (newest first): one card per run = experiment name · arm label · seed · date · brains · outcome line (`CROWN MERIDIAN +3.1% · HALDEN liquidated t=812`) · `$cost`. Data: `GET /lab/experiments` + detail `runs`.
- Leaderboard panel at the top (Task 8), showing `n` and CI bars on one shared axis, `insufficient` rows dimmed.
- Verify in browser on `db:local` with ≥ 2 done experiments; no console errors; commit `feat(ui): TIMELINE chronicles archive + leaderboard`.

### Task 10: Run replay

**Files:** Create `src/components/RunReplay.tsx`; Modify `TimelineView.tsx`, store (`replay` slice, fetched only when opened).

- Scrubber (range input + play/pause, keyboard ←/→) over ticks; one NAV chart, every fund on the same axes, a vertical cursor, event markers (Director events styled distinctly); a decision feed synced to the cursor: fund · tick · source badge (`LLM`/`policy`/`fallback`) · action · reasoning · tool calls · cost. Reduced-motion respected (no autoplay).
- "Copy link" puts `#/timeline/<id>/<arm>/<seed>` in the URL hash so a run is shareable; opening that hash loads the replay.
- Manifest footer: config hash, fund-profile hashes, digest — so a reader can rerun it.
- Verify: replay a policy run and (if Task 7 ran) a model run; scrub to a liquidation and see the matching decision; screenshot; commit `feat(ui): shareable run replay with synced reasoning feed`.

### Task 11: Phase 2 docs + review
D-041 (leaderboard rules: all done brains experiments, paired vs policy, n ≥ 5), FLOW/ARCHITECTURE/HANDOVER, FEATURE-014; diff review; commit.

---

## Phases 3–5 — scope notes for their own plans

- **Phase 3 (memory + behaviour):** `ArmConfig.memory: 'none' | 'episodic' | 'reflective' | 'full'` reusing `memory.ts` inside the sim (memory enters `RivalDecisionInput.memory`, so it only matters for model brains). Behavioural metrics, each a pure function over `DecisionRecord[]` + navs: action-mix entropy, mandate adherence (e.g. share of `short` actions for `cautious`), repeated-error rate (re-entry into a ticker within N ticks of a stopped-out loss), shock reaction (gross-exposure change in the K ticks after a major event). Definitions go to the user for approval before code.
- **Phase 4 (paper):** commit `paper/PREREGISTRATION.md` (hypotheses H1 cross-model, H2 memory, H3 Director, H4 cost-vs-quality; primary metric = paired total-return difference vs policy baseline; secondary = Sharpe, max drawdown, survival, fallback rate, $/decision; seeds 1–20 fixed; α = 0.05 with Holm; horizon; budget) **before** running. `scripts/export-paper.ts` reads done experiments → `paper/data/*.csv`, `paper/figures/*.svg` (hand-written SVG, no deps), `paper/tables/*.tex`, each value tagged `% exp=<id> cfg=<configHash>`. `paper/main.tex`: Abstract · Introduction · Environment · Agents & brains · Protocol · Results (H1–H4) · Behaviour & case studies (from replays) · Cost · Limitations · Responsible use · Reproducibility appendix. arXiv submission needs the user's account and an endorser.
- **Phase 5 (cross-vendor):** an OpenAI-compatible `fetch` adapter returning the same `LoopResult`, `MODEL_REGISTRY` entries with `provider: 'openrouter'`, separate budget metering. Needs the user's provider choice, keys and spend approval.
