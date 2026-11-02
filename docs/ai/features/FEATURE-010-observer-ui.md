# FEATURE-010 · Stage 6 observer UI
Status: shipped (branch `feat/stage6-observer-ui`)

## Scope
In:
- WORLD, FUNDS, FUND DETAIL, ACTIVITY views (VISION §13 1–4)
- `GET /world/funds/:id/trace` (decisions + model call + tool calls + memory), `GET /world/activity`
- Selected-fund focus; per-view polling; observer branding and copy

Out (later stages):
- TIMELINE replay, RESEARCH LAB (needs its own auth boundary), ANALYTICS (Stage 7)

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage6-observer-ui.md`
- [x] Task 1: observer endpoints
- [x] Task 2: store views + focus
- [x] Task 3: views
- [x] Task 4: docs + review

## Decisions
D-027

## Verification
`npm run typecheck` 0, `npm test` 190/190, `npm run lint` 0, `npm run build` ✓; Vite smoke with empty states.
Not verified: views with real data (no DB).
