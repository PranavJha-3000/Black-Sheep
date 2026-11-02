# FEATURE-007 · Stage 3 fund registry
Status: shipped (branch `feat/stage3-fund-registry`)

## Scope
In:
- Three configured AI funds (`config/funds.ts`) with identity, mandate, strategy, model, risk limit and a staggered decision slot
- Model registry with pricing (`config/models.ts`) for Stage 4 metering
- Per-personality deterministic fallback policies + risk-limit clamp on every decision (`packages/engine/src/policies.ts`)
- Per-fund LLM brain: fund system prompt, model, effort, policy fallback, refusal and thinking-block handling
- One server `Agent` per registered fund; public `profile` per fund in `/world/state`
- 10-company universe; old snapshots gain new listings on load
- FundsStrip: every fund's NAV, return, model and status

Out (later stages):
- Provider SDK adapter, cost metering and budgets (Stage 4)
- Agent memory (Stage 5); full multi-fund observer UI (Stage 6)

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage3-fund-registry.md`
- [x] Task 1: registry + policies + 10 companies
- [x] Task 2: per-fund LLM brain
- [x] Task 3: server agents, cadence, profiles
- [x] Task 4: client funds strip
- [x] Task 5: docs + review

## Decisions
D-020 (registry as config, name identity, default model), D-021 (fallback policies + risk clamp), D-022 (10-company universe, snapshot merge)

## Verification
After each task: `npm run typecheck` 0, `npm test` green (128/128 at Task 4), `npm run lint` 0; `npm run build` ✓ at Task 4.
Not verified: anything needing Postgres or a live provider key.
