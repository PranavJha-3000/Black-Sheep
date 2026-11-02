# FEATURE-005 · Stage 1 repo cleanup (research-lab pivot)
Status: shipped (branch `chore/stage1-cleanup`, unmerged)

## Scope
In:
- Remove human-controlled trading (OrderTicket, store buy/short/close, `POST /rooms/:code/trade`)
- Remove the browser LLM proxy; `makeLLMDecision` requires an explicit server endpoint
- Remove the "while you were away" re-engagement mechanic (server, engine, UI, config)
- Remove shareable result cards and `@vercel/og`
- Adopt `docs/VISION.md` as spec; archive the old game design doc

Out (deferred — irrelevant but load-bearing, replaced by later stages):
- Rooms / lobby / per-room worlds → Stage 2 global world (start from branch `wip/stage2-global-world`)
- Player `Fund` + `me` projection → fund registry / observer API (Stage 3)
- Single contrarian rival → 3 configured funds (Stage 3)
- Confrontation banner, contested tag, HeadToHead/RivalFund, LiquidationScreen copy → observer UI
- Prisma schema / migrations (untouched)

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage1-repo-cleanup.md`
- [x] Task 0: park broken WIP, green baseline
- [x] Task 1: vision docs, archive design doc, rollback entry
- [x] Task 2: remove human trading
- [x] Task 3: remove browser LLM proxy
- [x] Task 4: remove away-summary
- [x] Task 5: remove result cards + `@vercel/og`
- [x] Task 6: verification, diff review, handover

## Decisions
D-015 (Stage 1 is subtraction only; load-bearing game components deferred)

## Verification
`npm run typecheck`, `npm test`, `npm run lint`, `npm run build` green after every task; server `/health` boot smoke; grep gates per task.
