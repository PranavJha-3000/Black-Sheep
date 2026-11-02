# Stage 1: Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the code that only made sense for the old human-player game (human trading, browser LLM proxy, "while you were away" re-engagement, shareable result cards) and reset the docs to the new research-lab vision. Every check stays green, and the financial engine, persistence and server world loop are left intact.

**Architecture:** This is subtraction only. Each removal task deletes one vertical slice end to end: UI, store, server route, engine module, config constants, docs and tests. The tree typechecks, tests, lints and builds after every commit. Anything irrelevant that is still **load-bearing** (rooms, auth, lobby, the per-room world loop, the single rival) is *not* deleted here. It is listed under "Deferred" and gets replaced by later stages, starting with Stage 2 (one global world).

**Tech Stack:** TypeScript 5.5, React 18 + Vite 5 + Zustand 4, Express 4 + Prisma 6 (tsx), Vitest 2 (jsdom), npm workspaces (`@black-sheep/engine`).

**Spec:** `docs/VISION.md`, which holds the user's brief verbatim. Relevant sections: §1 (humans observe, they do not trade), §12 (deterministic world), §14 invariant 9 (credentials stay server-side), §15 (human-controlled trading, multiplayer and gamification are out of scope), and §17 (preserve reusable financial infrastructure, every stage buildable, no silent architectural changes).

## Global Constraints

- `AGENTS.md` and `docs/ai/` are authoritative. Do not edit `docs/ai/CONSTRAINTS.md`.
- Add no dependencies. Task 4 removes exactly one (`@vercel/og`), and only because this plan's approval covers it.
- Do not touch `prisma/schema.prisma` or `prisma/migrations/`. Schema reshaping belongs to Stage 2.
- Do not delete tests to make a build pass. Tests are deleted only together with the module they test, and each one is named in its task.
- Do not touch any file outside a task's **Files** list. If you find more work, add it to `docs/ai/HANDOVER.md` Open Items instead.
- After every task, all four commands must pass: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`.
- The only public API signature change is `makeLLMDecision`'s `endpoint` parameter becoming required (Task 3). It is called out for approval.
- Never claim live-DB verification. Docker/WSL is still unavailable on this machine (HANDOVER).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Current state (verified 2026-11-02, before this plan)

- **The working tree is broken.** An unfinished "Stage 2 global world" edit sits uncommitted: `server/world.ts` is gutted (149 lines, no tick loop), and `server/rooms.ts`, `server/away.ts` and `server/resultCard.ts` still import the removed `ensureWorld`, `getWorld` and `withWorldLock`. `npm run typecheck` fails in `tsc -p server` with about 40 errors. The untracked migration `prisma/migrations/20261101000000_add_world_model/migration.sql` is invalid SQL: there is no `;` after `CREATE TABLE`. The root `tsc` passes, and `npm test` passes 84/84.
- The same work in progress also deletes `OrderTicket.tsx` and the store's `buy`, `short` and `closePosition`. Task 2 redoes that removal properly.
- HEAD (`da08a4f`) is green according to HANDOVER. Task 0 confirms this.

## Inventory and verdicts

| Component | Verdict | Why |
|---|---|---|
| `packages/engine/src/{market,portfolio,events,types}.ts` + tests | **KEEP** | Deterministic, seeded, tested financial core (§5, §14.10) |
| `packages/engine/src/rival.ts` (`buildDecisionInput`, `makeRandomDecision`, `applyRivalDecision`, `detectConfrontation`) | **KEEP** | Information firewall, rule-based fallback and validated execution path (§6, §12). These are the seed of the 3-fund agents. |
| `packages/engine/src/rivalLLM.ts` | **KEEP, tighten (Task 3)** | Provider adapter with fallback. Its browser default path breaks §14.9. |
| `packages/engine/src/away.ts` + `away.test.ts` | **REMOVE (Task 4)** | Human-player re-engagement mechanic |
| `config/game.ts` | **KEEP** (drop `AWAY_*` in Task 4) | Single tuning source (D-014) |
| `server/{db,auth,index}.ts`, `server/world.ts` (HEAD), `server/rooms.ts` create/join/state | **KEEP (deferred)** | Load-bearing. The world loop ticks rooms. Auth is reused for the §13 privileged boundary. Stage 2 replaces rooms. |
| `server/rooms.ts` `POST /:code/trade` + `updatePeakNav` | **REMOVE (Task 2)** | Human-controlled trading (§15) |
| `server/away.ts`, `server/awayUtil.ts` | **REMOVE (Task 4)** | Away summary |
| `server/resultCard.ts` + `@vercel/og` | **REMOVE (Task 5)** | Viral share cards are gamification (§15) |
| Server liquidation (`liquidatePlayerFunds`, `LiquidationLog`, `deriveCauseOfDeath`) | **KEEP** | Margin and liquidation are core financial rules (§5). Cause of death is useful failure data. |
| `vite.config.ts` `llmProxyPlugin` | **REMOVE (Task 3)** | Browser LLM relay. Nothing on the client calls it any more, and it breaks §14.9. |
| `src/components/OrderTicket.tsx`, store `buy`/`short`/`closePosition`, `PositionRow` Close button | **REMOVE (Task 2)** | Human trading |
| `src/components/AwaySummary.tsx` + store away fields | **REMOVE (Task 4)** | Away summary |
| SHARE buttons in `FundSummaryPanel.tsx` and `LiquidationScreen.tsx` | **REMOVE (Task 5)** | Result cards |
| `docs/BLACK-SHEEP-DESIGN-DOC.md` | **ARCHIVE (Task 1)** | Superseded game design. History is kept. |
| `.clinerules/code.md` (0 bytes) | **REMOVE (Task 1)** | Empty |
| `.clinerules/coding_standard.md` | **UPDATE (Task 1)** | Still points agents at the superseded design doc |
| `README.md` | **UPDATE (Task 1)** | Still says "hedge-fund simulation game" |

### Deferred: irrelevant but load-bearing, so not deleted in Stage 1

Record each of these in HANDOVER Open Items (Task 6):

- Rooms, lobby and per-room worlds (`Room`, `LobbyScreen`, `POST /rooms`, `tickAllActiveRooms`) → **Stage 2: one global world**. The parked branch `wip/stage2-global-world` (Task 0) is the starting point. Its migration SQL must be fixed first.
- The player `Fund` and the `me` projection in `/state` and `stateMapper` → replaced by the fund registry and observer API (Stage 3).
- One contrarian rival (`APEX CAPITAL`, `RIVAL_SYSTEM_PROMPT` that mentions "the rival player") → 3 configured funds (Stage 3).
- Confrontation banner, `⚔` contested tag, HeadToHead/RivalFund, LiquidationScreen copy ("You lost their savings") → replaced wholesale by the observer UI (§13). Ripping them out piece by piece now is churn.
- `packages/engine/src/index.ts` barrel has zero importers but is the package's declared `"."` entry → leave it alone.
- `src/components/fmt.ts` `tickersOf` has zero callers → one-line dead helper. Log it, do not touch it (scope).

---

### Task 0: Park the broken WIP and confirm a green baseline

**Files:** none edited. This task only moves git state.

**Interfaces:**
- Produces: branch `wip/stage2-global-world` (the parked WIP), working branch `chore/stage1-cleanup` off `main` at `da08a4f`, and baseline test count `B` (expected 84).

- [ ] **Step 1: Commit only the WIP paths to a parking branch.** Do not use `git add -A`, because `docs/VISION.md` and this plan are untracked and must stay out of it.

```bash
git switch -c wip/stage2-global-world
git add docs/ai/ROLLBACK.md prisma/schema.prisma server/world.ts src/components/OrderTicket.tsx src/components/PositionRow.tsx src/components/Terminal.tsx src/store/gameStore.ts prisma/migrations
git commit -m "wip: park unfinished Stage 2 global-world refactor (server does not typecheck; migration SQL missing ';')"
git switch main
git switch -c chore/stage1-cleanup
```

- [ ] **Step 2: Verify the tree is HEAD plus the two untracked docs**

Run: `git status --short`
Expected: exactly `?? docs/VISION.md` and `?? docs/superpowers/`

- [ ] **Step 3: Baseline checks**

Run: `npm run typecheck; npm test; npm run lint; npm run build`
Expected: typecheck exits 0, vitest `Tests 84 passed (84)`, lint exits 0, and `vite build` prints `✓ built`. **If HEAD is not green, STOP and report. Do not fix it in this plan.**

---

### Task 1: Vision docs, archive the old design, rollback entry

**Files:**
- Create: `docs/archive/BLACK-SHEEP-DESIGN-DOC.md` (via `git mv`), `docs/ai/features/FEATURE-005-stage1-cleanup.md`
- Add (already written): `docs/VISION.md`, `docs/superpowers/plans/2026-11-02-stage1-repo-cleanup.md`
- Modify: `README.md`, `.clinerules/coding_standard.md`, `docs/ai/ROLLBACK.md`
- Delete: `.clinerules/code.md`

**Interfaces:** Produces `docs/VISION.md` as the spec every later stage cites.

- [ ] **Step 1:** `git mv docs/BLACK-SHEEP-DESIGN-DOC.md docs/archive/BLACK-SHEEP-DESIGN-DOC.md` and add one line under its H1: `> **ARCHIVED 2026-11-02.** Superseded by docs/VISION.md (research-lab direction). Kept for history; not a spec.`
- [ ] **Step 2:** Replace `README.md` with: the title, the one-line tagline from VISION ("A Long-Horizon Autonomous Financial Agent Laboratory."), a pointer to `docs/VISION.md`, and the setup commands from `package.json` (`npm install`, `npm run db:up`, `npm run server:dev`, `npm run dev`, `npm test`). Nothing more.
- [ ] **Step 3:** In `.clinerules/coding_standard.md`, replace `docs/BLACK-SHEEP-DESIGN-DOC.md (the target spec)` with `docs/VISION.md (the target spec)`. Change nothing else. `git rm .clinerules/code.md`.
- [ ] **Step 4:** Add a ROLLBACK entry at the top of `docs/ai/ROLLBACK.md`: `## Stage 1 repo cleanup · 2026-11-02`. Safe commit: `da08a4f`. Revert with: `git switch main` (the branch is unmerged), or after merge `git revert <first>..<last>`. Files touched: list the union of all Task 1–5 **Files** blocks. Non-code changes to undo: `npm install` after reverting Task 5 restores `@vercel/og`. Parked WIP: `wip/stage2-global-world`.
- [ ] **Step 5:** Create `FEATURE-005-stage1-cleanup.md` using the `docs/ai/TEMPLATES.md` feature template. Scope In is Tasks 2–5. Scope Out is the Deferred list. Plan is a checkbox per task, linking this plan file.
- [ ] **Step 6: Verify**

Run: `git grep -n "BLACK-SHEEP-DESIGN-DOC" -- . ':!docs/archive' ':!docs/ai' ':!docs/superpowers'`
Expected: no output. (The `docs/ai` history logs may keep their old references.)
Run: `npm run typecheck; npm test; npm run lint; npm run build` → all green, 84 tests.

- [ ] **Step 7: Commit:** `git add -A docs README.md .clinerules && git commit -m "docs: adopt research-lab vision, archive game design doc"`

---

### Task 2: Remove human-controlled trading

**Files:**
- Delete: `src/components/OrderTicket.tsx`
- Modify: `src/store/gameStore.ts` (drop the `buy`, `short` and `closePosition` interface members and implementations, plus any imports that become unused), `src/components/PositionRow.tsx` (drop the `close` selector and the Close `<td>`; if the table header in `Mid.tsx` has a matching empty column header, drop that one `<th>` too), `src/components/Terminal.tsx` (drop the import and slot; `StockChart` takes `col-span-12`), `server/rooms.ts` (delete `POST /:code/trade`, `updatePeakNav` and the imports that become unused; `tsc` `noUnusedLocals` will list them)
- Test: `src/store/rival.integration.test.ts`
- Docs: `docs/ai/FLOW.md` (Room lifecycle: no trade step), `docs/ai/ARCHITECTURE.md` (`server/rooms.ts` row), `docs/ai/TEST_CHECKLIST.md` (strike the `POST /rooms/:code/trade` row)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GameStoreState` without `buy`, `short` or `closePosition`. The server has no write route for human orders.

- [ ] **Step 1: Write the failing test** (append to the existing `describe` in `rival.integration.test.ts`)

```ts
it('is observer-only: the store exposes no trading actions', () => {
  const s = useGameStore.getState() as unknown as Record<string, unknown>;
  expect(s.buy).toBeUndefined();
  expect(s.short).toBeUndefined();
  expect(s.closePosition).toBeUndefined();
});
```

- [ ] **Step 2:** Run `npx vitest run src/store/rival.integration.test.ts`. Expected: FAIL (`buy` is a function).
- [ ] **Step 3:** Make the removals listed under Files.
- [ ] **Step 4:** Run `npx vitest run src/store/rival.integration.test.ts`. Expected: PASS (3 tests).
- [ ] **Step 5: Verify that no human order path remains**

Run: `git grep -nE "/trade|OrderTicket|closePosition\(id|\.buy\(|\.short\(" -- src server`
Expected: no output. (`closePosition` stays in the *engine* and `server/world.ts`, because the rival and liquidation use it.)
Run the 4 checks → all green, **85** tests.

- [ ] **Step 6: Commit:** `git commit -am "chore: remove human-controlled trading (observer-only, VISION §1/§15)"` (stage the deletion with `git rm src/components/OrderTicket.tsx` first)

---

### Task 3: Remove the browser LLM proxy and require an explicit server endpoint

**Files:**
- Modify: `vite.config.ts` (delete `llmProxyPlugin` and its doc comment; `plugins: [react()]`; drop the `loadEnv` and `Plugin` imports), `packages/engine/src/rivalLLM.ts` (delete `LLM_PATH` and its comment block; `makeLLMDecision(input: RivalDecisionInput, endpoint: LLMEndpointOptions): Promise<RivalDecision>`; `fetch(endpoint.url, { headers: { 'content-type': 'application/json', ...(endpoint.headers ?? {}) } ... })`; reword the `LLMEndpointOptions` doc so it says server-only)
- Test: `packages/engine/src/rivalLLM.test.ts` (pass `ENDPOINT` at the 5 existing call sites)
- Docs: `docs/ai/FLOW.md` ("LLM call with fallback" step 2: server only), `docs/ai/ARCHITECTURE.md` (drop the `vite.config.ts` row; the Secrets bullet says server only), `docs/ai/DECISIONS.md` (append `**Superseded 2026-11-02 by D-015**` to D-001), `docs/ai/TEST_CHECKLIST.md` (strike the `curl ... /api/llm` row)

**Interfaces:**
- Consumes: `server/world.ts` already calls `makeLLMDecision(input, { url, headers })`. Confirm with `git grep -n "makeLLMDecision(" server`. If any caller omits the endpoint, `tsc` will flag it.
- Produces: **public API change (needs approval):** the `endpoint` parameter is now required.

- [ ] **Step 1: Write the failing test** (new `it` in `rivalLLM.test.ts`, with `const ENDPOINT = { url: 'https://llm.test/v1/messages', headers: { 'x-api-key': 'test-key' } };` at module scope)

```ts
it('posts to the caller-supplied endpoint with merged headers (no browser default)', async () => {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"action":"hold","reasoning":"x","confidence":0.5}' }] }) });
  await makeLLMDecision(freshInput(), ENDPOINT);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe('https://llm.test/v1/messages');
  expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-api-key': 'test-key' });
});
```

- [ ] **Step 2:** Run `npx vitest run packages/engine/src/rivalLLM.test.ts`. Expected: the new test PASSES even before the change, because the optional parameter already honours the URL. Its job is to pin behaviour across the refactor. The step that *fails* is Step 3: once the type becomes required, `npm run typecheck` fails on the 5 old call sites until they pass `ENDPOINT`.
- [ ] **Step 3:** Make the edits listed under Files, then update the 5 call sites to `makeLLMDecision(freshInput(), ENDPOINT)`.
- [ ] **Step 4: Verify**

Run: `git grep -nE "api/llm|llmProxyPlugin|LLM_PATH" -- src packages server vite.config.ts`
Expected: no output.
Run the 4 checks → all green, **86** tests.

- [ ] **Step 5: Commit:** `git commit -am "chore: drop browser LLM proxy; provider calls are server-only (VISION §14.9)"`

---

### Task 4: Remove the "while you were away" re-engagement mechanic

**Files:**
- Delete: `server/away.ts`, `server/awayUtil.ts`, `packages/engine/src/away.ts`, `packages/engine/src/away.test.ts` (**6 tests, deleted with their module**), `src/components/AwaySummary.tsx`
- Modify: `server/index.ts` (drop the `awayRouter` import and mount), `server/rooms.ts` (drop the `lastSeenAt` stamp in `/state`; the column stays in the schema until Stage 2), `packages/engine/src/index.ts` (drop `export * from './away'`), `config/game.ts` (drop `AWAY_MIN_MS`, `AWAY_NAV_NOTABLE_DOLLARS`, `AWAY_POS_NOTABLE_DOLLARS` and their comments), `src/App.tsx` (render `<Terminal />` alone), `src/store/gameStore.ts` (drop `awaySummary`, `fetchAwaySummary`, `dismissAwaySummary`, `_initAwaySummary`, the post-join away fetch, and `lastSeenAt` from `GameSession` and state, including `loadSession`/`saveSession` and the poll stamp)
- Test: `src/store/rival.integration.test.ts`
- Docs: `docs/ai/FLOW.md` (delete the "Away-summary re-engagement" section), `docs/ai/ARCHITECTURE.md`, `docs/ai/TEST_CHECKLIST.md` (strike the away rows), `docs/ai/DECISIONS.md` (append `**Superseded 2026-11-02 by D-015**` to D-011)

**Interfaces:** Produces `GameSession = { token, user, roomCode }`.

- [ ] **Step 1: Write the failing tests** (in `rival.integration.test.ts`)

```ts
it('carries no away-summary state or actions', () => {
  const s = useGameStore.getState() as unknown as Record<string, unknown>;
  expect('awaySummary' in s).toBe(false);
  expect(s.fetchAwaySummary).toBeUndefined();
  expect(s.dismissAwaySummary).toBeUndefined();
});

it('restores a legacy persisted session that still has lastSeenAt', async () => {
  // Use the exact STORAGE_KEY literal from gameStore.ts.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: 't', user: { id: 1, email: 'a@b.c' }, roomCode: 'ABC234', lastSeenAt: 1 }));
  vi.resetModules();
  const { useGameStore: fresh } = await import('./gameStore');
  expect(fresh.getState().token).toBe('t');
  expect(fresh.getState().roomCode).toBe('ABC234');
  localStorage.clear();
});
```

(The second test pins Review Focus #2. Import `vi` from vitest and match the `user` shape to `GameSession['user']`.)

- [ ] **Step 2:** Run `npx vitest run src/store/rival.integration.test.ts`. Expected: the first test FAILS. The second test may already pass; it is a regression pin.
- [ ] **Step 3:** Make the deletions and edits listed under Files.
- [ ] **Step 4: Verify**

Run: `git grep -niE "away|lastSeenAt" -- src server packages config`
Expected: no output, except `lastSeenAt` inside the test fixture above.
Run the 4 checks → all green, **82** tests (86 − 6 + 2).

- [ ] **Step 5: Commit:** `git commit -am "chore: remove away-summary re-engagement mechanic"` (after `git rm` of the 5 deleted files)

---

### Task 5: Remove shareable result cards and `@vercel/og`

**Files:**
- Delete: `server/resultCard.ts`
- Modify: `server/index.ts` (drop the `resultCardRouter` import and mount), `src/components/FundSummaryPanel.tsx` (drop the SHARE button, `copied` state, `cardUrl`, `API_BASE` usage and the doc-comment lines about sharing), `src/components/LiquidationScreen.tsx` (drop the SHARE RESULT button and its state; keep cause, rival context and START AGAIN), `package.json` + `package-lock.json` via `npm uninstall @vercel/og` (keep `react`, because the client uses it)
- Docs: `docs/ai/FLOW.md` (delete the "Result-card endpoints" section), `docs/ai/ARCHITECTURE.md`, `docs/ai/TEST_CHECKLIST.md` (strike the result-card and SHARE rows), `docs/ai/DECISIONS.md` (append `**Superseded 2026-11-02 by D-015**` to D-013)

**Interfaces:** Produces a server with routes `/health`, `/auth/*` and `/rooms` (create, join, state) only.

- [ ] **Step 1:** Make the removals listed under Files. There is no new unit test: no server HTTP test harness exists, and adding one (e.g. supertest) would be a new dependency. The route check is Step 2 plus the boot smoke test in Task 6.
- [ ] **Step 2: Verify**

Run: `git grep -nE "result-card|resultCard|@vercel/og|SHARE" -- src server package.json`
Expected: no output.
Run: `npm ls @vercel/og`
Expected: `(empty)`.
Run the 4 checks → all green, **82** tests.

- [ ] **Step 3: Commit:** `git add -A server src package.json package-lock.json docs/ai && git commit -m "chore: remove shareable result cards and @vercel/og"`

---

### Task 6: Whole-branch verification, diff review and handover

**Files:**
- Modify: `docs/ai/HANDOVER.md` (rewrite **Current state** for Stage 1; replace the stale Open Items with the Deferred list plus "Stage 2 starts from `wip/stage2-global-world`; fix its migration `;` first"; add a log entry using CHANGED / WHY / VERIFY / NOT VERIFIED), `docs/ai/DECISIONS.md` (add **D-015**: the Stage 1 cleanup is subtraction only; load-bearing game components are deferred, not deleted; the rejected alternative was a big-bang rewrite to the global world plus observer API in one change, which breaks "one logical change" and leaves the tree unbuildable mid-way), `docs/ai/TEST_CHECKLIST.md` (test count `82 across 6 files`), `docs/ai/features/FEATURE-005-stage1-cleanup.md` (Status: shipped)

- [ ] **Step 1: Server boot smoke test** (Review Focus #1)

Run (background): `npm run server:dev`, then `curl -s localhost:3001/health`
Expected: `{"ok":true}` and `[server] listening on http://localhost:3001`. The world loop logs DB connection errors without a DB, and that is acceptable and pre-existing. Then stop the server.

- [ ] **Step 2: Client renders with no references to removed routes** (Review Focus #3)

Run `npm run dev` and open `http://localhost:5173` in the browser pane.
Expected: AuthScreen renders and the console has no import errors. The Terminal cannot be reached without a DB, so record that under NOT VERIFIED.

- [ ] **Step 3: Diff review** — `git diff --stat main...HEAD` and `git diff main...HEAD -- . ':!package-lock.json'`. Check that every changed path appears in a task's **Files** block, that the engine `market`/`portfolio`/`events`/`types`/`rival` sources are untouched apart from the `index.ts` export, and that there are no schema or migration changes.
- [ ] **Step 4:** Write the docs listed under Files. Run the 4 checks a final time → green, 82 tests.
- [ ] **Step 5: Commit:** `git commit -am "docs: Stage 1 cleanup handover, D-015"`. Do not merge or push without the user's go-ahead.

## Review Focus

1. **The server still boots after routers are removed.** `tsc` cannot prove `app.use` wiring. Covered by the Task 6 Step 1 `/health` smoke test.
2. **Returning observers carry an old localStorage session** with `lastSeenAt`. It must load, not crash. Covered by the Task 4 legacy-session test.
3. **A stale client call to a deleted endpoint** (`/trade`, `/away-summary`, `/result-card`) would 404 silently at runtime. Covered by the grep gates in Tasks 2, 4 and 5 plus the Task 6 Step 2 console check.
4. **Rival LLM decisions after the proxy removal.** The server must still reach the provider, and must fall back to the twin when there is no key. Covered by the Task 3 endpoint test plus the existing fallback tests in `rivalLLM.test.ts`. The required parameter makes any omitted caller a compile error.
5. **Liquidation must survive the removal of its share/UI surfaces.** It is core financial logic. Covered by the existing `portfolio.test.ts` `checkLiquidation`/`liquidateFund` tests. Task 6's diff review confirms that `server/world.ts` and `packages/engine/src/portfolio.ts` are unchanged.
