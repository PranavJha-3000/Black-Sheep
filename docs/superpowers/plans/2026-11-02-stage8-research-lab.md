# Stage 8 Research Lab Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Controlled experiment worlds (VISION §10 Mode B): define an experiment that varies ONE variable across arms, run every arm on the same seeds headless and fast-forwarded beside the live world, record reproducibility metadata, and compare arms in a RESEARCH LAB view. Creating experiments needs an admin token; viewing is public.

**Architecture:** A pure engine module (`experiment.ts`) holds the whole simulation of one world (same engine calls as the live tick, synchronous, no I/O), the arm expansion, hashing/manifest and the cross-seed comparison. The server stores experiments as one row each (config, manifest, results JSON) and runs a single-file queue that never touches the live world or its lock. A `/lab` router serves public reads and a token-guarded create.

**Tech Stack:** TypeScript, Vitest, Express 4, Prisma 6, React 18, Zustand.

**Spec:** `docs/VISION.md` §10 (Research Lab, Mode B, reproducibility), §11 (metrics), §13 (RESEARCH LAB view, separate authorization), §14 invariants 1, 3, 5, 7, 10. Scope bar: Emergence World's per-model worlds + mixed world with replays; Project Napoleon's rival-LLM leaderboard (user, 2026-11-02).

## Global Constraints
- Experiments are POLICY-ONLY: no provider call, no spend (user decision 2026-11-02). Model arms come in a later stage with their own budget.
- One variable per experiment: `directorMode` | `funds` | `decisionEveryTicks`.
- Limits (config/game.ts): `EXPERIMENT_MAX_TICKS = 5000`, `EXPERIMENT_MAX_SEEDS = 10`, `EXPERIMENT_MAX_ARMS = 6`, `EXPERIMENT_SERIES_POINTS = 200`.
- Experiment runs never read or write the live world, its `withWorldLock`, or live tables.
- `LAB_ADMIN_TOKEN` (env, server-side). Unset → create returns 503 (lab writes disabled). Wrong/missing bearer → 401. Constant-time comparison.
- Do not claim significance: show n, mean, sample std and paired win counts; the view says "not a significance test".
- Engine stays pure (no Date.now in new code; position ids/timestamps from `openPosition` are excluded from digests).

## Review Focus
1. Two runs of the same arm and seed produce an identical digest and identical metrics (reproducibility claim).
2. A fund liquidated mid-run stops deciding and stays liquidated; its NAV series continues at its post-liquidation value.
3. A malformed or oversized create request (unknown fund key, ticks 10^9, 50 seeds, variable not in the list, values with one entry) is rejected with 400 before anything is stored.
4. A server restart while an experiment is `running` re-queues it; the runner never processes two experiments at once.
5. The runner yields between runs so a long experiment does not stall the live world's 5 s tick.

---

### Task 1: Engine experiment core
**Files:** Create `packages/engine/src/experiment.ts`, `packages/engine/src/experiment.test.ts`; Modify `config/game.ts`.

**Produces:**
- `ArmConfig { funds: string[] /* registry keys */; directorMode: 'none' | 'rule'; decisionEveryTicks: number | null /* null = registry cadence */; ticks: number }`
- `ExperimentVariable = 'directorMode' | 'funds' | 'decisionEveryTicks'`
- `ExperimentSpec { name: string; base: ArmConfig; variable: ExperimentVariable; values: unknown[]; seeds: number[] }`
- `expandArms(spec): { label: string; config: ArmConfig }[]` — one arm per value, only `variable` differs.
- `simulateWorld(arm: ArmConfig, seed: number): RunResult` — per tick, mirroring `server/world.ts` `tickWorld`: `tickMarket(market, seed)`; scripted then random event with the live RNG formula; rule Director every `DIRECTOR_EVERY_TICKS` at `DIRECTOR_OFFSET` (separate RNG, tracked last event/intervention ticks); mark every fund and track peak; `checkLiquidation` → `liquidateFund`; NAV recorded every `SNAPSHOT_EVERY_TICKS`; each live fund on its slot (`tickCount % every === offset`, tick > 0) → `buildDecisionInput` → `decideByPolicy` → `enforceRiskLimit` → `applyTrade` → `applyRivalDecision`.
- `RunResult { seed; funds: { key; name; navs: number[]; liquidated: boolean; liquidatedAtTick: number | null; decisions: number; trades: number }[]; events: { type: string; priceImpactPercent: number; director: boolean }[]; directorInterventions: number; digest: string }`
- `fnv1a(text): string` (8 hex), `canonicalJson(value): string` (sorted keys), `experimentManifest(spec): { configHash; fundProfileHashes: Record<string,string>; seeds; engine: 'black-sheep-engine'; policyOnly: true; worldConstantsHash }`
- `compareArms(arms: { label; runs: RunResult[] }[], startingCapital): ArmComparison[]` — per arm and fund: n, mean/std of totalReturn, maxDrawdown, sharpe; survival rate; for arms after the first, paired mean difference in totalReturn vs arm 0 on the same seeds and wins (seeds where it beat arm 0). Plus per arm: mean events, mean director interventions. Series: `downsample(navs, EXPERIMENT_SERIES_POINTS)` of the first seed for charts.

- [ ] Tests first: same arm+seed → equal digest and metrics; different seeds → different digest; `directorMode: 'none'` → zero director interventions while `rule` over 2000 ticks → ≥ 1; `expandArms` differs only in the variable; a single-fund world runs; a fund forced to liquidate (tiny capital not possible — use a tick count where liquidation happens or construct via high `decisionEveryTicks`?) → instead unit-test the liquidation branch through an exported `stepWorld` on a hand-built state with an over-levered fund; `compareArms` paired wins and std on known inputs; `canonicalJson` key-order independence; `downsample` keeps first and last.
- [ ] Implement; `npm test` green; commit.

### Task 2: Experiment persistence, request parsing, runner
**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20261102050000_experiments/migration.sql`, `server/labCore.ts` + test, `server/experiments.ts`.

**Produces:**
- Model `Experiment { id Int @id @default(autoincrement()); createdAt DateTime @default(now()); name String; status String @default("queued") /* queued|running|done|failed */; variable String; specJson String; manifestJson String; resultJson String?; error String?; startedAt DateTime?; finishedAt DateTime?; @@index([status, id]) }`
- `parseExperimentRequest(body: unknown): { ok: true; spec: ExperimentSpec } | { ok: false; error: string }` — validates every field against the limits and the registry; dedupes values; ≥ 2 values.
- `checkLabToken(header: string | undefined, configured: string | undefined): 'ok' | 'disabled' | 'unauthorized'` (timingSafeEqual on equal-length buffers).
- `runExperimentSpec(spec, yieldFn): Promise<ExperimentResult>` — runs arms × seeds, awaiting `yieldFn()` between runs; `ExperimentResult { arms: ArmComparison[]; series: …; ranAt }`.
- `server/experiments.ts`: `startExperimentRunner()` — on start marks `running` rows back to `queued`; a poll (`EXPERIMENT_POLL_MS = 2000`) picks the oldest queued row, sets running, runs with `setImmediate` yields, stores done/failed. One at a time (in-process flag).
- [ ] Tests first for parse/token/runExperimentSpec (yield called arms×seeds times); migration via `prisma migrate diff`; commit.

### Task 3: `/lab` routes
**Files:** Create `server/labRoutes.ts`; Modify `server/index.ts`, `.env.example`.
- `GET /lab/experiments` (newest 50: id, name, status, variable, createdAt, finishedAt), `GET /lab/experiments/:id` (spec, manifest, result, error; 404), `POST /lab/experiments` (token check → 503/401; parse → 400; create row with manifest → 201 `{id}`).
- Start the runner in `server/index.ts` beside the world loop.
- [ ] Boot smoke: `POST` without token env → 503; commit.

### Task 4: RESEARCH LAB view
**Files:** Modify `src/store/gameStore.ts` (+test), `src/components/Terminal.tsx`; Create `src/components/ResearchLabView.tsx`.
- Store: view `'lab'`; `lab: { list; detail }`; list + selected detail polled only in the lab view; `openExperiment(id)`; `createExperiment(spec, token)` (token never stored in the store or storage).
- View: experiment list; detail with manifest (hashes, seeds, policy-only), arms × funds table (n, return mean ± sd, drawdown, Sharpe, survival, Δ vs baseline + wins), NAV sparkline of seed 1 per arm; create form (name, variable, values, base funds/director/cadence, ticks, seeds count, admin token field). Note: "n seeds; not a significance test."
- [ ] Store test first (lab polled only in view); Vite smoke; commit.

### Task 5: Docs, review, merge
D-032 (experiment worlds, policy-only, one-variable arms, JSON results), D-033 (lab authorization boundary), ROLLBACK (migration), FLOW, ARCHITECTURE, HANDOVER, TEST_CHECKLIST, FEATURE-012. Fresh Opus review; fix Critical/Important test-first; merge `--no-ff`; push.
