# Stage 5 — Persistent Agent Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every registered fund episodic, reflective and relationship memory that survives restarts, is shown to its model, and can be recalled with a tool.

**Architecture:** Memory rules are pure engine functions (`packages/engine/src/memory.ts`) that turn decisions, closes, liquidations and other funds' public actions into `MemoryEntry` values. The server persists them (`AgentMemory` table), keeps the latest per fund in memory, attaches them to the fund's `RivalDecisionInput.memory`, and the prompt + a `recall_memory` tool expose them. Memory is written deterministically — no extra provider spend.

**Tech Stack:** TypeScript, Vitest, Prisma 6 (new migration), existing engine/server.

**Spec:** `docs/VISION.md` §7 (memory), §9 (core tool "access relevant memory"), §6 decision cycle (EXPERIENCE → REMEMBER → REFLECT).

## Global Constraints
- Engine stays pure (no I/O); config files literal-only.
- Agent isolation (D-017): a fund's memory may hold other funds' PUBLIC actions (action + ticker), never their sizes, cash or positions.
- "Do not claim learning when only persistent memory has been implemented" (§7): reflections are deterministic summaries; docs and prompt call them memory, not learning.
- New migration generated offline; never edit an applied migration.

## Review Focus
1. Restart: memory loaded from DB in id order, capped per fund — newest kept.
2. A rejected trade (no fill) or a hold writes no episode.
3. Relationship notes never include another fund's size or book.
4. Reflection only fires after enough closes, and not twice for the same closes.
5. Memory write failure must not block the decision being applied.

---

### Task 1: Engine memory rules + prompt + recall tool
**Files:** Create `packages/engine/src/memory.ts` + `memory.test.ts`; modify `rival.ts` (`RivalDecisionInput.memory?`), `rivalLLM.ts` (prompt section), `fundTools.ts` (`recall_memory`), `config/game.ts` (`MEMORY_*`).

**Produces:**
- `type MemoryKind = 'episodic' | 'reflective' | 'relationship'`
- `interface MemoryEntry { kind; tickCountAt: number; subject: string | null; content: string; importance: number; outcomeUsd: number | null }`
- `episodeFromDecision(after: RivalFund, nav: number, tick: number): MemoryEntry | null` — buy/short with `fillPrice` → "Opened LONG|SHORT T $X at $p — reasoning"; close with `realizedPnL` → "Closed T for ±$X — reasoning", `outcomeUsd` = realized; otherwise null.
- `episodeFromLiquidation(cause: string, tick: number): MemoryEntry` (importance 1).
- `reflect(memory: MemoryEntry[], tick: number): MemoryEntry | null` — over closed-trade episodes since the last reflection; null below `MEMORY_REFLECT_EVERY_CLOSES` (3). Content: wins/losses, net, best/worst ticker, one rule-based observation.
- `relationshipNote(selfPositions: Position[], otherName: string, other: RivalLastDecision, tick): MemoryEntry | null` — other opened opposite to self on a held ticker → "X shorted T while I was long" (0.6); same side → crowded (0.3); else null. Never includes sizes.
- `selectMemories(memory, n)` — latest reflection, latest 2 relationship notes, then highest-importance recent episodes, up to `n`.
- `buildRivalUserMessage` adds "Your memory (persisted notes, not learned weights):" when memory exists.
- Tool `recall_memory {kind?, subject?, limit?}` → newest-first filtered entries (limit ≤ 20).

Tests: each rule's trigger and null cases; reflection threshold and no double-reflection; relationship note has no `$`; selectMemories ordering/cap; prompt includes memory lines only when present; recall_memory filters and caps; the tool is in `FUND_TOOLS`.

### Task 2: Persistence + orchestration
**Files:** `prisma/schema.prisma` + migration `20261102030000_agent_memory`; `server/world.ts`; `server/worldCore.ts` (payload `memory` per fund: latest 5 `{kind, tickCountAt, subject, content}`); `server/worldRoutes.ts`; tests in `worldCore.test.ts`.

- `AgentMemory` (worldId, fundId, kind, tickCountAt, timestamp, subject?, content, importance, outcomeUsd?), cascade on world/fund, `@@index([fundId, id])`.
- Load: latest `MEMORY_LOAD_LIMIT` (40) rows per agent → `agent.memory` (oldest first).
- After a decision applies: episode (+ reflection if due) for the fund; relationship notes for every other live agent. After liquidation: liquidation episode. `rememberAll` writes rows outside the transaction and never throws; in-memory cap 40.
- `chooseDecision` input carries `memory: agent.memory`.

Tests: payload carries `memory` for funds with entries and `[]` otherwise (pure builder).

### Task 3: Docs, review, merge
D-026 (deterministic memory, isolation, no learning claim), ROLLBACK (migration), FLOW, ARCHITECTURE, HANDOVER, TEST_CHECKLIST, FEATURE-009.
