# FEATURE-006 · Stage 2 global live world
Status: shipped (branch `feat/stage2-global-world`, unmerged)

## Scope
In:
- One persistent seeded world (`World` row named `live`) replaces rooms, lobby and per-room worlds
- Offline-generated init migration (`prisma/migrations/20261102000000_init`)
- Pure world rules in `server/worldCore.ts` (seed resolution, snapshot integrity, decision cadence, public payload) with unit tests
- Public observer API `GET /world/state`; client polls it without an account
- Every fund can be liquidated; a liquidated fund stays visible and stops deciding
- Remove auth/lobby screens and the player-vs-rival UI (HeadToHead, RivalFund, ConfrontationBanner, LiquidationScreen, `⚔` marker)

Out (later stages):
- Fund registry of ~3 configured AI funds (Stage 3)
- Multi-fund observer UI (the terminal still focuses the lowest-id fund)
- Multi-process leader election; experiment-mode worlds
- Dropping `User`, `server/auth.ts` and `LiquidationLog.rivalContext`

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage2-global-world.md`
- [x] Task 1: pure world core + tests, config constants
- [x] Task 2: remove player-vs-rival UI
- [x] Task 3: schema, init migration, live world, public route
- [x] Task 4: client observes `/world/state`; drop auth and lobby
- [x] Task 5: docs, decisions, handover

## Decisions
D-016 (World replaces Room, keeps `worldId`), D-017 (observation public; agent isolation in `buildDecisionInput`), D-018 (seed resolved once and persisted), D-019 (all funds liquidatable; liquidated funds stop deciding)

## Verification
`npm run typecheck`, `npm test` (91/91), `npm run lint`, `npm run build` green after every task; `npx prisma validate`; migration SQL checks; server `/health` boot smoke; Vite client smoke; grep gates per task. Live-DB behaviour not verified (no Postgres).
