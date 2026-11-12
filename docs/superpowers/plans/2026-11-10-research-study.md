# Research Study — Phases 3–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the research instrument. Phase 3 adds a memory ablation and behavioural metrics. Phase 4 adds a pre-registered study, plus an exporter that turns finished experiments into paper-ready CSV / SVG / LaTeX. Phase 5, last, adds cross-vendor model brains through a fetch-based OpenAI-compatible API adapter.

**Architecture:**
- **Engine.** Memory and behaviour tracking stay in the pure engine:
  - `simMemory.ts` gives model-brained funds in-world memory, using the same rules as the live world (`memory.ts`).
  - `behaviour.ts` turns a per-fund decision trail into five numbers that are stored on `RunResult`.
- **Paper.** The paper pipeline is a pure formatter module (`server/paperCore.ts`) plus thin scripts: `scripts/export-paper.ts` and `scripts/run-study.ts`.
- **Cross-vendor brains.** A second provider adapter (`server/providers/openaiCompat.ts`) returns the same `LoopResult` as the Anthropic one, so `labBrain.ts` only routes by `MODEL_REGISTRY[model].provider`.

**Tech Stack:** TypeScript, Vitest, Express, Prisma 6 / Postgres, React + Zustand + Tailwind. No new dependencies. LaTeX source only; no TeX toolchain is added.

**Spec:**
- `docs/VISION.md`: §4 (research questions), "Behavioural performance" (strategy consistency, risk adaptation, repeated decision errors, reaction to market shocks, behavioural diversity, memory usefulness), "Model benchmarking", §16 (reports).
- The roadmap rows for Phases 3–5 in `docs/superpowers/plans/2026-11-09-research-grade-lab.md`.
- The user, 2026-11-10: "Continue for the full build add APIs at last".

**Branch:** `feat/stage10-research-study`, stacked on `feat/stage9-research-lab` (PR #1).
- Its PR targets `feat/stage9-research-lab` until #1 merges, then is retargeted to `main`.
- Merging or pushing is asked about at the end.

## Gates — what this plan does NOT do without the user

| Gate | Where | Why |
|---|---|---|
| G1. **This plan's metric definitions** (Task 2 table) are approved with the plan | before Task 2 | The Phase 3 scope note says the definitions go to the user before code |
| G2. **Running the study** (`scripts/run-study.ts --confirm`) | after Task 7 | Real spend; the dry-run estimate is printed first |
| G3. **arXiv submission** | after the study | Needs the user's account and an endorser |
| G4. **Which cross-vendor models, and their prices** | start of Task 9 | Model IDs and $/MTok change often; the implementer reads them from OpenRouter's `/api/v1/models`, and the user confirms them before commit |
| G5. **Keyed smoke runs** (Anthropic and OpenRouter) | end of Phases 3 and 5 | Key plus spend; until then, live behaviour stays NOT VERIFIED |

## Global Constraints

- No new dependencies (AGENTS.md). The Phase 5 adapter uses global `fetch`.
- The engine stays pure: `packages/engine` imports no express, prisma, react, SDK or `fs`.
- Policy-only digests stay **byte-identical**: seed 7 rule → `52f9903a`, seed 21 none → `22858214` (existing pinned tests must keep passing unchanged).
- **No schema change and no migration in this plan.** New per-run data goes into `resultJson`.
- Old stored specs keep their `configHash`. Every new `ArmConfig` field is optional (`canonicalJson` drops `undefined`).
- The experiment budget cap stays `EXPERIMENT_MAX_BUDGET_USD = 25`, and the seed cap stays `EXPERIMENT_MAX_SEEDS = 10`. The study is split into experiments that each fit.
- Every async route goes through `wrap()`. Lab writes need `LAB_ADMIN_TOKEN`.
- Provider keys come only from the server's env (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`). Keys never reach the browser, logs or `resultJson`.
- The live world stays Anthropic-only. Cross-vendor brains exist only in Lab experiments.
- `resultJson` growth budget: behaviour adds at most 5 numbers per fund per run. No new per-tick series are stored.
- Docs: DECISIONS D-043…, FEATURE-015 (Phase 3), FEATURE-016 (Phase 4), FEATURE-017 (Phase 5), plus HANDOVER/FLOW/ARCHITECTURE, all in each phase's last task.

## Review Focus

1. **Memory variable on a policy-only arm.** Memory is ignored, because only model brains read it. Digests equal the arm without `memory`. (Task 1 test `memory does not change policy-only digests`.)
2. **Behaviour metric with no qualifying events** (no losing closes, no shocks, no non-hold proposals) → `null`, never `NaN` or `0`. The UI shows `—`. (Task 2 tests `returns null when …`.)
3. **Study spec over the $25 cap or over 10 seeds** → `run-study` refuses before submitting anything and names the file. (Task 6 test `rejects a study file whose estimate exceeds the cap`.)
4. **OpenAI-compatible provider returns malformed tool arguments, HTTP 429/5xx, or times out** → the loop retries `LLM_MAX_RETRIES` times on 429/5xx. It never throws. It returns `decision: null` with outcome `'error'` and the cost actually incurred, and the fund falls back to its policy. (Task 8 tests.)
5. **Cross-vendor brain requested without `OPENROUTER_API_KEY`** → create is rejected with 400 `No key on the server for provider openrouter.`, and nothing is queued. (Task 9 test.)

---

## Phase 3 — Memory ablation + behavioural metrics

### Task 1: `memory` arm variable

**Files:**
- Create: `packages/engine/src/simMemory.ts`, `packages/engine/src/simMemory.test.ts`
- Modify: `packages/engine/src/experiment.ts` (ArmConfig, SimFund, `simulateWorldAsync`, EXPERIMENT_VARIABLES), `server/labCore.ts` (VALUE_CHECKS + base check), `server/labCore.test.ts`

**Interfaces:**
- Produces:
  - `export type MemoryMode = 'none' | 'episodic' | 'reflective' | 'full'`
  - `ArmConfig.memory?: MemoryMode`, where absent means `'none'`
  - `SimFund.memory: MemoryEntry[]`
  - `'memory'` in `EXPERIMENT_VARIABLES`
  - `updateSimMemory(funds: SimFund[], decided: { f: SimFund; source: DecisionSource }[], tick: number, mode: MemoryMode, markNav: (f: SimFund) => number): void`
- Consumes: `episodeFromDecision`, `reflect`, `relationshipNote` and `MEMORY_LOAD_LIMIT` from `memory.ts` / `config/game.ts`.

Semantics:
- **none:** nothing is recorded.
- **episodic:** the fund's own filled trades only.
- **reflective:** episodic plus `reflect()` after each losing or winning close.
- **full:** reflective plus `relationshipNote` for every other fund holding the ticker.

Recording follows the live `rememberDecision` (server/world.ts:633). Memory is capped at `MEMORY_LOAD_LIMIT`, keeping the newest entries. Only funds whose `brain !== 'policy'` get memory written and passed as `input.memory`. Policy funds keep `input.memory` undefined, which is what makes digests safe.

- [ ] **Step 1: Write failing tests** in `simMemory.test.ts`:
  - `none records nothing`
  - `episodic records an opened LONG after a filled buy` (content starts `Opened LONG`)
  - `reflective adds a reflection after MEMORY_REFLECT_EVERY_CLOSES closes`
  - `full adds a relationship note to a fund holding the ticker`
  - `caps memory at MEMORY_LOAD_LIMIT`

  In `experiment.test.ts`:
  - `memory does not change policy-only digests`: the pinned seed 7 / 21 specs with `memory: 'full'` still give `52f9903a` / `22858214`.
  - `model fund sees its episodes on the next decision`: arm `memory: 'episodic'`, a model brain on one fund, and a stub `DecideFn` that buys once then holds. It asserts the next `ctx.input.memory.length === 1`; with `memory: 'none'` the length stays `0`.
  - `spec without memory keeps its configHash`.
- [ ] **Step 2: Run** `npx vitest run packages/engine/src/simMemory.test.ts packages/engine/src/experiment.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `simMemory.ts`, then wire it into `simulateWorldAsync`:
  - Pass `memory` into the input of model funds only.
  - Call `updateSimMemory` after `applyDecisions` with each fund's `source`.
  - `simulateWorld` (sync) stays untouched.
- [ ] **Step 4: Add `'memory'` to `EXPERIMENT_VARIABLES`** and a `checkMemory` validator in `labCore.ts`:
  - Accepted values are the four modes.
  - Error copy: `memory must be one of none, episodic, reflective, full.`
  - The base `memory` is optional.
  - labCore tests: `accepts memory as the variable`, `rejects an unknown memory mode`.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(lab): memory ablation arm variable (none/episodic/reflective/full)`.

### Task 2: Behavioural metrics (definitions = Gate G1)

**Files:**
- Create: `packages/engine/src/behaviour.ts`, `packages/engine/src/behaviour.test.ts`
- Modify: `packages/engine/src/experiment.ts` (SimFund trail, `summarize`, `RunResult`, `compareArms`), `config/game.ts` (constants)

**Interfaces:**
- Produces:
  - `export interface TrailStep { tick: number; action: 'buy'|'short'|'close'|'hold'; ticker: string | null; clamped: boolean; realizedPnL: number | null; direction: 'long'|'short'|null }`
  - `export interface Behaviour { actionEntropy: number | null; riskCompliance: number | null; repeatedErrorRate: number | null; shockDeRisk: number | null; tradeRate: number | null }`
  - `computeBehaviour(trail: TrailStep[], gross: { tick: number; grossPct: number }[], shocks: number[]): Behaviour`
  - `RunResult.funds[].behaviour: Behaviour`
  - `FundArmStats.behaviour: Record<keyof Behaviour, Stat | null>` (mean + bootstrap CI over runs, nulls skipped; `null` when no run has a value)

**Definitions** (one value per fund per run; the arm statistic is the mean across seeds with a bootstrap 95% CI):

| Metric (VISION name) | Definition | Null when |
|---|---|---|
| `actionEntropy` (behavioural diversity) | Shannon entropy of the counts of {buy, short, close, hold} over all decisions, ÷ log2(4). 0 = one action only, 1 = uniform. | no decisions |
| `riskCompliance` (strategy consistency) | Share of non-hold proposals that `enforceRiskLimit` left unchanged (`clamped === false`). | no non-hold proposals |
| `repeatedErrorRate` (repeated decision errors) | Of the closes with `realizedPnL < 0` on ticker T, the share followed by a new open on T **in the same direction** within `BEHAVIOUR_REPEAT_WINDOW_TICKS = 50` ticks. | no losing closes |
| `shockDeRisk` (reaction to market shocks) | Mean over shocks of `grossPct(t) − grossPct(t + BEHAVIOUR_SHOCK_WINDOW_TICKS)`, where a shock is an event with `abs(priceImpactPercent) ≥ BEHAVIOUR_SHOCK_MIN_IMPACT_PCT = 5`, `BEHAVIOUR_SHOCK_WINDOW_TICKS = 30`, and `grossPct = Σ|position notional| ÷ NAV × 100` sampled at the nav cadence. Positive = cut exposure after the shock. Shocks whose window runs past the end are skipped. | no usable shocks |
| `tradeRate` (risk adaptation, activity) | trades ÷ decisions. | no decisions |

"Memory usefulness" is the H2 contrast itself (return vs `memory=none`), not a per-run metric.

`clamped` is computed in both the sync and async paths as `!sameDecision(proposed, enforced)`, comparing action, ticker and dollarAmount. The gross series lives only in `SimFund` and is dropped in `summarize`, so it never reaches `resultJson`. Shocks come from `s.log`.

- [ ] **Step 1: Write failing tests** in `behaviour.test.ts`, with exact values:
  - `entropy is 0 for all holds and 1 for one of each action`
  - `riskCompliance is 0.5 when one of two opens was clamped`
  - `repeatedErrorRate is 1 when a losing long on NOVA is re-opened long 10 ticks later`
  - `repeatedErrorRate is 0 when the re-open is short or after 60 ticks`
  - `shockDeRisk is 20 when grossPct goes 50 → 30 after a 6% shock`
  - `returns null when there are no decisions, no losing closes, or no shocks`, with every null case.

  In `experiment.test.ts`:
  - `behaviour is attached to every fund and digests are unchanged`
  - `compareArms reports behaviour means with CI and skips nulls`
- [ ] **Step 2: Run** `npx vitest run packages/engine/src/behaviour.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `behaviour.ts` and the constants. Record `TrailStep` in `applyDecisions`, taking `clamped` from the caller. Sample `grossPct` wherever `navs` is pushed.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: pass, with the pinned digests unchanged.
- [ ] **Step 5: Commit** `feat(lab): behavioural metrics per fund-run with arm CIs`.

### Task 3: Lab UI + Phase 3 docs

**Files:**
- Modify: `src/components/ResearchLabView.tsx`, `docs/ai/{DECISIONS,FLOW,ARCHITECTURE,HANDOVER}.md`
- Create: `docs/ai/features/FEATURE-015-memory-and-behaviour.md`

**Interfaces:**
- Consumes: `MemoryMode` (Task 1) and `FundArmStats.behaviour` (Task 2).

- [ ] **Step 1: Update the form.**
  - Add a "Memory" select for the base (default `none`).
  - Add a variable option `{ value: 'memory', label: 'Memory (none / episodic / reflective / full)' }` with checkboxes for the four modes.
  - Show the hint `Memory only affects model brains.` when no fund has a model brain.
- [ ] **Step 2: Update the results.**
  - Add a "Behaviour" table under each arm: one row per fund, with columns entropy, risk compliance, repeated errors, shock de-risk and trade rate.
  - Format each cell as `mean [lo, hi]`, or `—` when null.
  - Add `title` tooltips carrying the one-line definitions from Task 2.
- [ ] **Step 3: Verify in the browser.** Run `npm run db:local`, the api and web previews, then:
  - Create a policy-only `memory` experiment (2 seeds, 300 ticks).
  - When it finishes, check the behaviour table renders and the console is clean.
- [ ] **Step 4: Write the docs.**
  - D-043: memory modes, and why policy funds get none.
  - D-044: the metric definitions, verbatim from Task 2's table.
  - FEATURE-015, and FLOW (async loop now updates memory).
  - HANDOVER: G5 is still NOT VERIFIED.
- [ ] **Step 5: Run** `npm test && npm run typecheck && npm run lint && npm run build`, then commit `feat(ui): memory variable and behaviour table; docs D-043/D-044`.

---

## Phase 4 — Pre-registered study + paper pipeline

### Task 4: Paper formatters (pure)

**Files:**
- Create: `server/paperCore.ts`, `server/paperCore.test.ts`

**Interfaces:**
- Consumes: `compareArms`, `bootstrapMeanCI` and `holm` from the engine, and the stored detail shape (`buildExperimentDetail`).
- Produces:
  - `export interface StudyRow { hypothesis: string; experimentId: number; configHash: string; arm: string; fundKey: string; seed: number; totalReturnPct: number; maxDrawdownPct: number; sharpe: number | null; survived: boolean; fallbackRate: number | null; costUsd: number; decisions: number; behaviour: Behaviour }`
  - `studyRows(experiments: { id: number; name: string; resultJson: unknown; specJson: unknown }[]): StudyRow[]`. The hypothesis is parsed from the experiment name prefix `study:<H>:`; malformed rows are skipped.
  - `pairedContrasts(rows: StudyRow[], hypothesis: string, baselineArm: string): { arm: string; n: number; meanDiff: number; ci: [number, number]; pSign: number; pHolm: number }[]`. It pairs by (fundKey, seed) on subject funds across all of the hypothesis's experiments, and applies Holm across the hypothesis's arms.
  - `toCsv(rows: StudyRow[]): string`. The header is the StudyRow keys in order, with behaviour flattened as `behaviour_<name>`.
  - `texTable(contrasts, caption: string, label: string, tag: string): string`. A `booktabs` table whose first line is `% <tag>`.
  - `svgForest(contrasts, title: string, tag: string): string`. A hand-written SVG forest plot (point + CI line per arm, zero line), 640×(80+40·arms) px, starting with `<!-- <tag> -->`.
  - `svgReturnSeries(series: { label: string; points: number[] }[], title: string, tag: string): string`.

`tag` is always `exp=<ids joined by ,> cfg=<configHashes joined by ,>`.

- [ ] **Step 1: Write failing tests.**
  - `studyRows skips non-study and malformed experiments`
  - `pairedContrasts pools pairs across seed-block experiments` (two experiments of seeds 1–5 and 6–10 give n=10)
  - `pairedContrasts applies Holm across arms` (p=[0.03,0.06,0.06] → [0.09,0.12,0.12]; reuse the stats example)
  - `toCsv escapes commas and quotes`
  - `texTable starts with the provenance tag and escapes & and %`
  - `svgForest is well-formed and contains one circle per arm`
- [ ] **Step 2: Run** `npx vitest run server/paperCore.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `paperCore.ts`. Number formatting is fixed to 2 decimals (4 for p-values).
- [ ] **Step 4: Run** the tests. Expected: PASS. Then commit `feat(paper): pure study formatters (csv, tex, svg) with provenance tags`.

### Task 5: Exporter script

**Files:**
- Create: `scripts/export-paper.ts`, `paper/README.md`
- Modify: `package.json` (script `"paper:export": "tsx scripts/export-paper.ts"`)

**Interfaces:**
- Consumes: Task 4, plus `prisma` from `server/db.ts`.

Behaviour:
- Load every `status: 'done'` experiment whose `name` starts with `study:`.
- Write the following, overwriting:
  - `paper/data/study.csv`
  - for each hypothesis H: `paper/tables/<H>.tex` and `paper/figures/<H>-forest.svg`
  - for H1: `paper/figures/H1-returns.svg`, the mean NAV path per arm from the stored downsampled navs
- Print one line per file with its row count.
- If there are no study experiments, exit with code 1 and the message `No done experiments named study:* — run the study first.`

The baseline arm per hypothesis comes from the first value of its spec, which is the existing convention.

- [ ] **Step 1: Implement.** The script stays thin; logic lives in `paperCore`.
- [ ] **Step 2: Verify.** Run `npm run db:local`, then create two tiny policy-only experiments named `study:H3:test-a` / `study:H3:test-b` (directorMode, 2 seeds, 200 ticks) through the API with the token. Then run `npm run paper:export`, and confirm the files appear and the `.svg` opens in the browser preview.
- [ ] **Step 3: Delete** the generated test outputs (paper outputs are committed only from the real study). Commit `feat(paper): export-paper script`.

### Task 6: Pre-registration + study specs + guarded runner

**Files:**
- Create:
  - `paper/PREREGISTRATION.md`
  - `paper/study/H1-<model>-s<block>.json` (one file per model per seed block)
  - `paper/study/H2-memory-s<block>.json`, `paper/study/H3-director-s<block>.json`
  - `scripts/run-study.ts`
  - `server/studyPlan.ts`, `server/studyPlan.test.ts`
- Modify: `package.json` (`"study:run": "tsx scripts/run-study.ts"`)

**Interfaces:**
- Produces: `checkStudyPlan(files: { path: string; spec: unknown }[], estimate: (spec: ExperimentSpec) => number): { ok: true; totalUsd: number; perFile: { path: string; usd: number }[] } | { ok: false; error: string }`. It reuses `parseExperimentRequest` (with `providerConfigured: true`) and `estimateExperimentCostUsd`.

**PREREGISTRATION.md** content (exact):
- **H1 (cross-model).** For subject fund `crown-meridian`, arms are policy vs Haiku 5.5 vs Sonnet 5.5 vs Opus 5.5. Each model is its own experiment pair (policy vs model).
- **H2 (memory).** The subject is on Haiku 5.5, with arms memory none / episodic / reflective / full. Baseline: none.
- **H3 (Director).** The subject is on Haiku 5.5, with directorMode none vs rule.
- **H4 (cost vs quality).** Derived from H1: mean paired return difference per $ spent.
- **Primary metric:** paired total-return difference vs the hypothesis baseline.
- **Secondary metrics:** Sharpe, max drawdown, survival, fallback rate, $/decision, and the five behaviour metrics.
- **Protocol:**
  - Seeds 1–20, in blocks of 5 (`s1` = 1–5 … `s4` = 16–20).
  - Horizon: 500 ticks.
  - `decisionEveryTicks`: 10.
  - All three funds are present; only the subject has a model brain.
- **Statistics:** paired bootstrap 95% CI (2000 iterations, seeded); exact sign test; Holm within each hypothesis; α = 0.05.
- **Exclusions:** none. Every finished experiment is reported, and failed ones are listed with their error.
- **Budget:** each experiment is ≤ $25. The worst-case total is printed by `study:run`, and the user approves it before `--confirm`.

`run-study` behaviour:
1. Refuse unless `paper/PREREGISTRATION.md` is committed and unmodified (`git diff --quiet HEAD -- paper/PREREGISTRATION.md` plus `git ls-files --error-unmatch`). Message: `Commit paper/PREREGISTRATION.md before running the study.`
2. Run `checkStudyPlan` and print a per-file and total worst-case $.
3. Without `--confirm`, stop there (a dry run).
4. With `--confirm` and env `LAB_ADMIN_TOKEN` and `LAB_API_URL` (default `http://localhost:3001`), POST each spec in file order, then print the returned ids.

- [ ] **Step 1: Write failing tests** in `studyPlan.test.ts`:
  - `accepts the committed study files`, which loads the real `paper/study/*.json`.
  - `rejects a study file whose estimate exceeds the cap` (the error names the path).
  - `rejects more than 10 seeds`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `studyPlan.ts` and write the study JSON files:
  - Names are `study:H1:haiku:s1` etc.
  - `budgetUsd` is set to the file's own estimate rounded up to the next dollar, capped at 25.
  - If an Opus block does not fit under $25 with 5 seeds, split it into blocks of 3 and note the change in PREREGISTRATION before it is committed.
- [ ] **Step 4: Run** `npm test`, then `npm run study:run` (dry run). Expected: per-file estimates are printed, and the total matches the sum.
- [ ] **Step 5: Commit** PREREGISTRATION.md together with the study files: `docs(paper): pre-registration and study specs`. That commit is the pre-registration timestamp.

### Task 7: Paper skeleton + Phase 4 docs

**Files:**
- Create: `paper/main.tex`, `paper/refs.bib`, `docs/ai/features/FEATURE-016-paper-pipeline.md`
- Modify: `docs/ai/{DECISIONS,HANDOVER,ARCHITECTURE}.md`

`main.tex` follows the arXiv 2610.22319 section order: Abstract · Introduction · Environment · Agents & brains · Protocol · Results (H1–H4) · Behaviour & case studies · Cost · Limitations · Responsible use · Reproducibility appendix.
- **Written now, from code:** Environment, Agents & brains, Protocol, Reproducibility. Every constant is cited with its config name.
- **Results / Behaviour / Cost:** `\input{tables/H*.tex}` and `\includegraphics` of the SVG figures (via the `svg` package). Each section has one marked paragraph, `% WRITE AFTER DATA`, for narrative.
- `refs.bib`: Emergence World blog, arXiv 2610.22319, napole0n.ai.

- [ ] **Step 1: Write** `main.tex` and `refs.bib`. Verification: a brace/environment balance check by script (`node -e` counting `\begin`/`\end` pairs). PDF compilation is NOT VERIFIED (no TeX toolchain).
- [ ] **Step 2: Write the docs.** D-045 covers the pre-registration rule (the study runs only after its commit; deviations are logged in the paper's appendix). Add FEATURE-016, and record G2/G3 in HANDOVER.
- [ ] **Step 3: Commit** `docs(paper): paper skeleton and Phase 4 docs`.

---

## Phase 5 — Cross-vendor API brains (last)

### Task 8: OpenAI-compatible provider adapter

**Files:**
- Create: `server/providers/openaiCompat.ts`, `server/providers/openaiCompat.test.ts`

**Interfaces:**
- Consumes: `DecisionRequest`, `LoopResult` and `ToolCallRecord` from `./anthropic`; `FUND_TOOLS`, `SUBMIT_DECISION` and `parseSubmittedDecision` from the engine; `costOfUsage`; `LLM_TIMEOUT_MS` and `LLM_MAX_RETRIES`.
- Produces:
  - `export type ChatFetch = (body: unknown) => Promise<{ status: number; json: unknown }>`
  - `export function openaiCompatFetch(baseUrl: string, apiKey: string): ChatFetch`. It POSTs `${baseUrl}/chat/completions` with `Authorization: Bearer`, uses `AbortSignal.timeout(LLM_TIMEOUT_MS)`, and never logs the key.
  - `export async function runOpenAICompatLoop(chat: ChatFetch, req: DecisionRequest): Promise<LoopResult>`

Behaviour:
- Tools map to `{ type: 'function', function: { name, description, parameters: input_schema } }`, and `tool_choice: 'auto'`.
- `max_tokens: req.maxTokens`.
- Each round: append the assistant message; run each `tool_calls[i]` through `req.runTool` after `JSON.parse(arguments)`. A parse failure becomes a failed ToolCallRecord with a `{ error }` result sent back. Then add `role: 'tool'` messages.
- A `submit_decision` call ends the loop with `outcome: 'decided'`.
- A plain text answer goes through `parseDecisionText`; otherwise the outcome is `'no_decision'`.
- `finish_reason: 'length'` → `'max_tokens'`. Running past `maxRounds` → `'round_cap'`.
- HTTP 429/5xx are retried up to `LLM_MAX_RETRIES` with a 500 ms × attempt backoff. Any other non-2xx, or exhausted retries → `'error'`, with an `error` string that has no key and no body over 200 characters.
- Usage is summed as `prompt_tokens → input_tokens` and `completion_tokens → output_tokens`, with cache fields at 0. `servedBy = response.model`.

- [ ] **Step 1: Write failing tests**, all with an injected `ChatFetch`:
  - `decides via submit_decision in one round`
  - `runs a research tool then decides`
  - `malformed tool arguments are reported to the model, not thrown`
  - `retries a 429 then succeeds`
  - `gives outcome error after retries are exhausted and never throws`
  - `sums usage and cost across rounds`
  - `round cap ends with round_cap`
- [ ] **Step 2: Run** `npx vitest run server/providers/openaiCompat.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS. Commit `feat(providers): fetch-based OpenAI-compatible decision loop`.

### Task 9: Registry, routing and keys (Gate G4 first)

**Files:**
- Modify:
  - `config/models.ts`
  - `server/labBrain.ts`, `server/labBrain.test.ts`
  - `server/labCore.ts`, `server/labCore.test.ts`
  - `server/labRoutes.ts`, `server/experiments.ts`
  - `config/funds.ts` (type only)
  - `src/components/ResearchLabView.tsx`
  - `.env.example`

**Interfaces:**
- Produces:
  - `provider: 'anthropic' | 'openrouter'` on every registry entry.
  - `export type AnthropicModelId`, the registry keys whose provider is `'anthropic'`. `FundProfile.model` narrows to this, so the live world stays Anthropic-only at compile time.
  - `parseExperimentRequest(body, { providers: ReadonlySet<'anthropic' | 'openrouter'> })`, replacing `providerConfigured`.
  - `makeExperimentDecide(clients: { anthropic: CreateMessage | null; openrouter: ChatFetch | null }, budget)`.

- [ ] **Step 0 (Gate G4):** Fetch `https://openrouter.ai/api/v1/models` and propose 3 entries (one OpenAI, one Google, one xAI flagship), each with an exact id, display name and $/MTok in/out. Ask the user to confirm. Do not commit before confirmation.
- [ ] **Step 1: Write failing tests.**
  - labCore:
    - `rejects an openrouter brain without OPENROUTER key` (the message is exactly `No key on the server for provider openrouter.`)
    - `accepts mixed providers when both keys are present`
    - the existing no-key message is still used when no provider is configured at all.
  - labBrain:
    - `routes openrouter models to the chat adapter and anthropic models to the SDK loop`
    - `meters openrouter cost against the same experiment budget`
- [ ] **Step 2: Implement.**
  - Add the registry entries (`cacheReadMultiplier: 1`, `cacheWriteMultiplier: 1`, `effort: 'low'`, which is ignored by this adapter).
  - In `labBrain`, branch on `MODEL_REGISTRY[model].provider`.
  - `experiments.ts` builds both clients from env. The OpenRouter base URL is `https://openrouter.ai/api/v1`.
  - `labRoutes` passes the configured set.
  - `.env.example` gains `OPENROUTER_API_KEY=` (empty).
  - The UI brain picker groups models by provider.
- [ ] **Step 3: Run** `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 4: Verify in the browser** with no OpenRouter key: picking an OpenRouter brain shows the estimate error `No key on the server for provider openrouter.`
- [ ] **Step 5: Commit** `feat(lab): cross-vendor brains via OpenRouter (lab only)`.

### Task 10: Phase 5 docs + handover

**Files:**
- Create: `docs/ai/features/FEATURE-017-cross-vendor-brains.md`
- Modify: `docs/ai/{DECISIONS,FLOW,ARCHITECTURE,HANDOVER}.md`, `paper/PREREGISTRATION.md` **only through an amendment section** if H1 gains cross-vendor arms (dated, before those runs).

- [ ] **Step 1: Write the docs.**
  - D-046: lab-only cross-vendor brains, the provider routing, and why the live world stays on Anthropic.
  - D-047: pricing source and refresh rule.
  - FEATURE-017.
  - HANDOVER: G2, G3 and G5 remain open.
- [ ] **Step 2: Run** `npm test`. Commit `docs(ai): Phase 5 cross-vendor brains (D-046, D-047)`.
