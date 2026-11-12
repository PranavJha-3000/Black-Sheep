# FEATURE-014 · Stage 9 research-grade lab, Phase 2
Status: shipped on branch `feat/stage9-research-lab` (unmerged); live-model behaviour UNVERIFIED

## Scope
In:
- Public leaderboard: `GET /lab/leaderboard`, pure `server/leaderboardCore.ts` (subject funds, paired vs all-policy baseline arm, `insufficient` when n < 5)
- TIMELINE view (`TimelineView.tsx`, `chronicle.ts`): leaderboard panel plus run cards for the newest `CHRONICLE_MAX_EXPERIMENTS` (10) done experiments
- Run replay (`RunReplay.tsx`, `replay.ts`): NAV chart on exact `navTicks`, decision feed synced to the cursor, play/pause at 150 ms per point, manifest footer with hashes, shareable URL hash

Out (later phases):
- Phase 3 memory and behaviour metrics; Phase 4 paper export and study; Phase 5 other providers
- `hashchange` routing; leaderboard caching

## Plan
Full plan: `docs/superpowers/plans/2026-11-09-research-grade-lab.md` (Phase 2)
- [x] Task 8: leaderboard core + route
- [x] Task 9: TIMELINE chronicle + leaderboard panel
- [x] Task 10: run replay with synced reasoning feed
- [x] Task 11: docs

## Decisions
D-041

## Verification
`npm test` 337 passing (29 files) at Task 11. Typecheck, lint and build were run by the Task 8-10 implementers; not re-run in this docs-only task.
Not verified: a leaderboard or replay built from a real model-brain experiment (the keyed, paid smoke run has not been done; it is the user's step); load behaviour of the unpaged leaderboard query; Safari or mobile.
