# FEATURE-012 · Stage 8 Research Lab foundation
Status: shipped (branch `feat/stage8-research-lab`)

## Scope
In:
- Controlled experiment worlds (VISION §10 Mode B): pure `simulateWorld`, one-variable arms (`directorMode`, `funds`, `decisionEveryTicks`), paired seeds
- Reproducibility manifest (config, fund-profile and world-constant hashes; seeds) and per-run digests
- `Experiment` table, single-file runner beside the live world, `/lab` routes with an admin-token write boundary
- RESEARCH LAB view: list, manifest, per-arm paired results, NAV charts, digests, create form
- Rule Director recalibration (it never fired before)

Out (later):
- Model-backed arms and memory ablations (need spend approval and a per-experiment budget)
- TIMELINE replay; automated research reports; cross-experiment queries

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage8-research-lab.md`
- [x] Task 1: engine experiment core (+ Director recalibration)
- [x] Task 2: persistence, validation, runner
- [x] Task 3: `/lab` routes
- [x] Task 4: RESEARCH LAB view
- [x] Task 5: docs + review

## Decisions
D-032, D-033 (and the D-029 recalibration note)

## Verification
`npm run typecheck` 0, `npm test` 268/268, `npm run lint` 0, `npm run build` ✓; boot smoke — POST 503 / 401 / 400 paths, GET 404; Vite smoke — results rendered from a real 2-arm × 5-seed engine result.
Not verified: the migration, the runner and routes against a live DB (no Postgres).
