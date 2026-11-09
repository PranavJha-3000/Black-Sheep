# FEATURE-015 · Stage 10 research study, Phase 3: memory and behaviour
Status: built on branch `feat/stage10-research-study` (unmerged); live-model behaviour and Gate G5 (keyed smoke run) UNVERIFIED

## Scope
In:
- `memory` experiment variable (`none` / `episodic` / `reflective` / `full`), base setting and arm axis, validated server-side
- `simMemory.ts`: memory updated after decisions are applied, model-backed funds only
- `behaviour.ts`: five per-fund-run behaviour metrics, arm mean with bootstrap CI
- Lab UI: Memory select and variable, hint, BEHAVIOUR table with definition tooltips

Out (later phases):
- Phase 4 pre-registered study and paper export; Phase 5 other providers
- Cross-run memory carry-over; persisted memory

## Plan
Full plan: `docs/superpowers/plans/` (research study, Phase 3)
- [x] Task 1: memory variable and `simMemory.ts`
- [x] Task 2: behavioural metrics
- [x] Task 3: Lab UI and docs

## Decisions
D-043, D-044

## Verification
`npm test`, typecheck, lint and build run at Task 3 (counts in the Task 3 report). Browser check of the Lab UI is done by the controller.
Not verified: a keyed run with memory arms (Gate G5); old experiments render an em dash for behaviour by design.
