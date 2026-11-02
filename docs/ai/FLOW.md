# Execution Flow

## Server world tick (Phase 3 — the world moves unattended)
Entry: `server/world.ts → startWorldLoop()` → `setInterval(5s)` → `tickAllActiveRooms()`

1. `prisma.room.findMany({ status: 'active' })`
2. Per room: `worlds.get(id) ?? ensureWorld(id)` — rebuild from latest `MarketTick.snapshotJson` (`{market, scheduler}`) + Fund/Position rows + last `RivalDecisionLog`; or bootstrap `createInitialMarket()` + rival fund
3. `tickMarket(market, seed)` → `maybeFireScriptedEvent`/`generateEvent` → `applyEvent`
4. `trackPeakNav(w)` — compute NAV for every fund at new prices; update `Fund.peakNav` if a new all-time high
5. `liquidatePlayerFunds(w)` — **server-authoritative liquidation**: for each non-rival, non-liquidated fund with open positions, reconstruct engine Fund from DB rows, run `checkLiquidation(fund, market)`. If `atRisk`: force-close all positions at market price (DB writes), mark `Fund.liquidated = true`, compute `deriveCauseOfDeath`, look for rival context via `computeRivalContext` (replays last 6 `RivalDecisionLog` entries through `detectConfrontation`), write a `LiquidationLog` row. All in one transaction.
6. Event fired? → `MarketEventLog` row
7. `tickCount % 3 === 0`? → `MarketTick` row (`snapshotJson`)
8. `tickCount % 10 === 0 && !rivalPending`? → fire `decideRival()` non-blocking
9. `decideRival`: `buildDecisionInput` → `makeLLMDecision(input, {url: api.anthropic.com, headers: x-api-key})` or `makeRandomDecision` (no key) → `applyTrade` (rival moves price) → `applyRivalDecision` (shared player engine) → persist in ONE transaction: Fund.cash + added/removed Positions + `RivalDecisionLog` row

Assumptions: single server process (in-memory `worlds` map is truth between snapshots); a rebuild can lose ≤2 ticks of drift.
Side effects: Postgres writes; one Anthropic call per rival decision (when key present).
Fragile: Express 4 async routes need `wrap()`; the world clock keeps running through per-room errors (logged, not thrown).
Watch: `liquidatePlayerFunds` runs inside the room lock (serialized with ticks and rival decisions; there are no human trades since Stage 1); a player closing their tab CANNOT dodge liquidation — it is evaluated and persisted entirely server-side.

## Room lifecycle (REST)
Entry: `server/rooms.ts`

1. `POST /auth/register|login` → bcrypt verify → JWT `{sub: userId}` (7d)
2. `POST /rooms` (auth) → 6-char code (collision-retried) → Room + rival Fund (userId null, $10M) → `ensureWorld` warm-up
3. `POST /rooms/:code/join` (auth) → active room check → idempotent (existing fund returned) → maxPlayers check → create Fund (named from email local-part, $10M)
4. `GET /rooms/:code/state` (auth + membership) → market prices/tickCount, all funds `{nav, netExposure}`, OWN positions/cash/availCash, `flow` (per-ticker net flow), rival lastDecision, recentEvents

Assumptions: caller holds a valid bearer token; room code uppercase-normalized.
Side effects: reads only (except join/create).
Fragile: the state endpoint intentionally omits other funds' positions/cash — do not "helpfully" add them back; that's the design pillar.

## LLM call with fallback (server only)
Entry: `packages/engine/src/rivalLLM.ts → makeLLMDecision(input, endpoint)` — `endpoint` is required; the only caller is `server/world.ts`

1. Build body (`claude-sonnet-4-6`, `max_tokens: 300`, `RIVAL_SYSTEM_PROMPT`, user message from `buildRivalUserMessage`)
2. `fetch(endpoint.url)` — server only: direct Anthropic URL with `x-api-key` header (the endpoint is a required argument; the browser proxy was removed in Stage 1)
3. `extractText` → `stripFences` (```json …```) → `firstJsonObject` → `JSON.parse` → `isRivalDecision` guard
4. ANY failure (HTTP !ok, no text, no JSON, wrong shape, network) → `catch` → **`makeRandomDecision(input)`** — the game never stalls
5. Without a key: server skips the call and uses the twin directly

Assumptions: the fallback twin returns a valid, executable decision.
Side effects: one API call per fired decision (gated upstream).
Fragile: if the model ID is ever retired, every call 404s and the rival silently plays rule-based — check the console warning.
