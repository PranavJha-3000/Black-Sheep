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
Watch: `liquidatePlayerFunds` runs inside the room lock (serialized with trades/ticks); a player closing their tab CANNOT dodge liquidation — it is evaluated and persisted entirely server-side.

## Result-card endpoints (Phase 3 — shareable outcome cards)
Entry: `server/resultCard.ts → resultCardRouter`

1. `GET /funds/:id/result-card` (public, no auth) → `buildResultCard(fundId)`:
   - Load fund + ensure world (live market)
   - Compute current NAV from open positions at market prices
   - Load latest `LiquidationLog` (if any)
   - Scan all closed positions for best single trade (highest PnL)
   - Return JSON: `{ fundId, name, startingCapital, peakNav, finalNav, cause, rivalContext, durationTicks, bestSingleTrade, liquidated }`
2. `GET /funds/:id/result-card.png` (public, no auth) → same `buildResultCard`, then render a 1200×630 PNG via `@vercel/og` `ImageResponse` using `React.createElement` (dark terminal aesthetic, NAV/cause/PnL layout). Returns `Content-Type: image/png` with 30s cache.

Assumptions: fundId is not easily guessable enough to be a concern for V1 (auto-increment int); the payload never exposes positions/cash (information firewall holds for unauthenticated viewers).
Side effects: read-only (no writes). One `ensureWorld` call per request.
Fragile: `@vercel/og` uses `satori` + `@resvg/resvg-wasm`; no custom fonts bundled (satori default). If the user wants exact JetBrains Mono, they need to load a TTF and pass it via the `fonts` option.

## Room lifecycle (REST)
Entry: `server/rooms.ts`

1. `POST /auth/register|login` → bcrypt verify → JWT `{sub: userId}` (7d)
2. `POST /rooms` (auth) → 6-char code (collision-retried) → Room + rival Fund (userId null, $10M) → `ensureWorld` warm-up
3. `POST /rooms/:code/join` (auth) → active room check → idempotent (existing fund returned) → maxPlayers check → create Fund (named from email local-part, $10M)
4. `GET /rooms/:code/state` (auth + membership) → market prices/tickCount, all funds `{nav, netExposure}`, OWN positions/cash/availCash, `flow` (per-ticker net flow), rival lastDecision, recentEvents

Assumptions: caller holds a valid bearer token; room code uppercase-normalized.
Side effects: reads only (except join/create).
Fragile: the state endpoint intentionally omits other funds' positions/cash — do not "helpfully" add them back; that's the design pillar.

## Game tick (client-only, Phases 1-2; replaced by the server in Phase 4)
Entry: `src/components/Terminal.tsx` → `setInterval` → `gameStore.tick()`

1. `tick()` — early-return if `liquidated`
2. `tickMarket(prev)` — price evolution (pure; `recentFlow` threaded through)
3. `maybeFireScriptedEvent` / `generateEvent` → `applyEvent` — seeded, deterministic
4. **Rival decision gate** — every `RIVAL_DECISION_TICKS` (10) ticks, not already thinking, `positions.length < 6`
5. `buildDecisionInput` → `shouldRivalReconsider` guard → fire `makeLLMDecision` (non-awaited, `rivalThinking` gates re-entry)
6. Resolution (async, re-reads current state): abort if `liquidated || !rivalThinking`; `applyTrade` (rival moves price); `applyRivalDecision` (shared engine); `detectConfrontation` (gated on EXECUTED actions; `opposite` deduped per episode, `rival_win` re-fires) → `confrontation` + `contested` state
7. Player state re-derived (rival trades must not leave player NAV stale)
8. `set({...})` — single trailing state write per tick

Assumptions: JS single thread — tick and resolution never interleave mid-function.
Side effects: LLM call (cost), rival portfolio, market prices, flow log.
Fragile: the two long `set({...})` calls are one-line-per-field — edits there are where mangles have happened.

## LLM call with fallback (shared by client + server)
Entry: `packages/engine/src/rivalLLM.ts → makeLLMDecision(input, endpoint?)`

1. Build body (`claude-sonnet-4-6`, `max_tokens: 300`, `RIVAL_SYSTEM_PROMPT`, user message from `buildRivalUserMessage`)
2. `fetch(endpoint?.url ?? '/api/llm')` — browser: Vite proxy with server-side key; server: direct Anthropic URL with `x-api-key` header
3. `extractText` → `stripFences` (```json …```) → `firstJsonObject` → `JSON.parse` → `isRivalDecision` guard
4. ANY failure (HTTP !ok, no text, no JSON, wrong shape, network) → `catch` → **`makeRandomDecision(input)`** — the game never stalls
5. Without a key: client proxy returns 500 → fallback; server skips the call and uses the twin directly

Assumptions: the fallback twin returns a valid, executable decision.
Side effects: one API call per fired decision (gated upstream).
Fragile: if the model ID is ever retired, every call 404s and the rival silently plays rule-based — check the console warning.

## Away-summary re-engagement (Phase 4 — "while you were away")
Entry: `server/away.ts → GET /rooms/:code/away-summary?since=<ms epoch>`

1. Authenticate + resolve caller's Fund for the room
2. Clamp `since` to `now`; find nearest `MarketTick` snapshot at or before `since` (fallback: current prices)
3. Reconstruct NAV-then from snapshot prices + fund cash; NAV-now from live market
4. `positionDeltas(rows, priceThen, priceNow)` — per-position PnL excursion (shared engine math)
5. `relevantEvents(events, heldTickers)` — only events on held tickers (never the full firehose)
6. `confrontationsDuringAway(heldPositions, rivalDecisions)` — replays logged rival decisions through `detectConfrontation`
7. `isNotable(summary)` — window ≥2min AND (NAV moved ≥$25K OR position moved ≥$10K OR confrontation)
8. Return `{ ...summary, notable }` — client only stores when `notable: true`

Assumptions: `since` is client-supplied (stateless); snapshot cadence bounds reconstruction accuracy.
Side effects: read-only (no writes).
Fragile: the endpoint trusts the client's `since` — a skewed clock widens/narrowers the window (acceptable for V1; `isNotable` is the real protection).

Client flow: `enterRoom()` → `fetchAwaySummary(roomCode)` → GET with `since = session.lastSeenAt` → store only if `notable` → `AwaySummary.tsx` renders over terminal → "ENTER TERMINAL" → `dismissAwaySummary()`.


