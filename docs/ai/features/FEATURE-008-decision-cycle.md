# FEATURE-008 · Stage 4 decision cycle, tools and cost metering
Status: shipped (branch `feat/stage4-decision-cycle`)

## Scope
In:
- Pure fund research tools (`inspect_company`, `inspect_portfolio`, `calculate_risk`, `recent_events`, `submit_decision`)
- Server-only Anthropic SDK adapter with a bounded, metered tool loop
- Budget ledger: per-fund and global daily USD limits, concurrency cap, UTC-day reset, re-seeded on boot
- `LlmCallLog` / `ToolCallLog` persistence; decision source/model/call id on every `RivalDecisionLog`
- Public per-fund spend vs budget and decision source; FundsStrip shows both

Out (later stages):
- Agent memory and memory tools (Stage 5); observer views and cost analytics (Stages 6–7)
- A second provider adapter; runtime-editable budgets

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage4-decision-cycle.md`
- [x] Task 1: engine tools + pure parsing
- [x] Task 2: pricing + budget ledger
- [x] Task 3: SDK adapter, migration, orchestration
- [x] Task 4: client strip
- [x] Task 5: docs + review

## Decisions
D-023 (SDK adapter, engine purity), D-024 (tools + loop bounds + material-change gate), D-025 (budget ledger, metering, decision source)

## Verification
After each task: `npm run typecheck` 0, `npm test` green (157/157 at Task 4), `npm run lint` 0; `npm run build` ✓.
Not verified: anything needing Postgres or a live provider key.
