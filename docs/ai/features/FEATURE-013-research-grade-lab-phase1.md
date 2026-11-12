# FEATURE-013 · Stage 9 research-grade lab, Phase 1
Status: shipped on branch `feat/stage9-research-lab` (unmerged); live-model behaviour UNVERIFIED

## Scope
In:
- Async experiment world (`simulateWorldAsync`, injected `DecideFn`); policy-only digests unchanged
- `brains` variable: a fund's brain is `policy` or a registry model; per-arm model brains
- Model-backed brains in `server/labBrain.ts` with a hard per-experiment budget (`budgetUsd` ≤ 25), no-key rejection, and no re-queue of paid runs after a restart
- Statistics: bootstrap CI, exact sign test, Holm correction (`stats.ts`)
- `ExperimentDecision` table (every decision of every run) and public per-run replay endpoint (`GET /lab/experiments/:id/runs/:arm/:seed`)
- RESEARCH LAB form: per-fund brain select, budget field, live worst-case estimate (`?dryRun=1`); results table with CI, Δ vs baseline, Holm p, fallback rate, cost per run

Out (later phases of the plan):
- Phase 2: chronicle/replay UI (TIMELINE view) and leaderboard; Phase 4: paper export and the study; Phase 5: other providers (e.g. Jev)
- Measured cost figures (needs the keyed smoke run)

## Plan
Full plan: `docs/superpowers/plans/2026-11-09-research-grade-lab.md` (Phase 1)
- [x] Task 1: async engine loop with injectable brains
- [x] Task 2: bootstrap CI, sign test, Holm
- [x] Task 3: model-backed brains and budget (`labBrain.ts`)
- [x] Task 4: persist decisions and per-run series (migration `20261109000000_experiment_decisions`)
- [x] Task 5: per-run replay endpoint
- [x] Task 6: lab form brains + budget, CI and Holm p in results
- [ ] Task 7 step 1: keyed smoke run (`brains`, `[{}, {'crown-meridian':'claude-haiku-5-5'}]`, seeds `[1,2]`, 300 ticks, `budgetUsd: 1`) — NOT RUN, user action (spend + key)
- [x] Task 7 steps 2-3: docs

## Decisions
D-038, D-039, D-040

## Verification
Implementer at `d7c8663`: `npm run typecheck`, `npm run lint`, `npm run build` clean; `npm test` 322 passing. Task 4: on `npm run db:local` the migration applied (6/6) and `prisma migrate diff` reported no drift.
Controller check on `db:local` with `ANTHROPIC_API_KEY` blank: experiment #34 (`directorMode` none vs rule, 5 seeds, 600 ticks) ran to `done`; the results table shows mean [95% CI], Δ vs baseline [CI] and Holm p; `GET /lab/experiments/34/runs/directorMode%3Drule/3` → 200 with `navTicks` [3,6,9,…] and 180 decisions; a model-brain dry run → 400 "Model brains need a provider key on the server."; a dry run without the token → 401; no console errors.
Not verified: any live model call; actual $/decision, fallback rate and latency; the plan's cost table is still estimates (Haiku ~0.002, Sonnet ~0.044, Opus ~0.088 $/decision); Safari/mobile; `?dryRun=1` route branch has no route-level test.
