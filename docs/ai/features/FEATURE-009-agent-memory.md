# FEATURE-009 · Stage 5 persistent agent memory
Status: shipped (branch `feat/stage5-agent-memory`)

## Scope
In:
- Episodic memory (filled trades, closes with outcome, liquidation), reflective summaries every 3 closes, relationship notes from other funds' public moves
- `AgentMemory` persistence, reload on boot, in-process cache of 40 per fund
- Memory in the decision prompt and a `recall_memory` tool
- Five newest memories per fund in `/world/state`

Out (later stages):
- Observer UI for memory (Stage 6); memory ablations per experiment (VISION §10)
- Model-written reflections; relevance retrieval

## Plan
Full plan: `docs/superpowers/plans/2026-11-02-stage5-agent-memory.md`
- [x] Task 1: engine memory rules, prompt, tool
- [x] Task 2: persistence + orchestration + payload
- [x] Task 3: docs + review

## Decisions
D-026

## Verification
`npm run typecheck` 0, `npm test` 177/177, `npm run lint` 0, `npm run build` ✓.
Not verified: anything needing Postgres or a live provider key.
