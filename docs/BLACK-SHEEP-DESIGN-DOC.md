# BLACK SHEEP — Design & Build Document

> **Audience:** humans (understand the idea) and AI coding agents (know what to build, why, and what to do when it breaks).
> **Status legend:** ✅ built (Phases 1–3) · 🔧 to build · ❓ open decision · ⚠️ assumption (a placeholder number/name I proposed, not a decision you made — tune freely).
> **Rule for agents:** if this doc and the code disagree, do not silently pick one. Flag it in `docs/ai/HANDOVER.md` Open Items.

---

## 0. TL;DR (30 seconds)

A browser game where you run your own hedge fund inside **one shared, always-persistent fictional stock market** that opens and closes on a schedule. You are the **"Black Sheep"**: a former star trader who got fired in disgrace and is rebuilding with your parents' savings. Several **established AI hedge funds** (each a different LLM personality) dominate the market. You keep the *Black Sheep* title until you have **defeated every AI fund** by overtaking its NAV and holding the lead. Once you grow past a threshold, the AI funds and other players can start attacking you. If you're liquidated, you lose your parents' money and start over.

**One-line pitch:** *Billions × Clash of Clans, where the rivals are AIs that trade against you and can't cheat.*

**Why it's worth building:** a live market moved by players + LLM agents playing an adversarial game with visible reasoning is technically interesting, demoable in 15 seconds, and hard to clone quickly.

---

## 1. Story & tone

### 1.1 Lore (canonical)
You were a top performer at an elite hedge fund. You made a catastrophic mistake and were fired so badly you couldn't get out of bed for weeks. You lost the girlfriend, the house, and most of your friends. Only your parents still believed in you. They handed you their life savings. You open your own fund with it. The industry calls you **"the Black Sheep."** You keep that label until you beat the funds that wrote you off.

### 1.2 Tone rules
- Terminal-cold, confident, sparse. Big numbers, short sentences.
- The depression/loss backstory is **restrained**: 3–4 lines on the intro screen, skippable, never a cutscene, never played for cheap sympathy.
- AI funds are dismissive, not cartoon-evil. They see you as a disgraced ex-employee until you're a real threat, then their tone sharpens.
- Reasoning strings from AI funds: **1–2 sentences max.**

### 1.3 Copy bank (use as-is or vary)
| Moment | Line |
|---|---|
| Intro | "You were the best they had. Then you weren't." / "Your parents gave you everything they saved." / "Prove them wrong." |
| Liquidation | "You lost their savings." / "THE INDUSTRY WAS RIGHT ABOUT YOU." |
| Fund defeated | "{FUND} has been overtaken." |
| Final win | "THEY SHOULD'VE NEVER LET YOU GO." Title flips: **Black Sheep → (new title ❓)** |
| AI attack banner | "{FUND} IS NOW SHORT {TICKER} — AGAINST YOUR POSITION" |

---

## 2. Design pillars (decision filter)

Every feature must serve at least one pillar. If it serves none, cut it.

1. **Simple surface, deep underneath.** Player action is `BUY $500K`. Complexity is discovered, not dumped.
2. **Loss is explainable.** The player must be able to say "I overleveraged," never "the game cheated." Deterministic rules, visible warnings.
3. **AI plays fair.** AI funds only see what a real trader could see. Provably.
4. **The world moves without you.** Persistence + "While you were away" is the core re-engagement loop.
5. **It gets harder as you succeed.** Attention/attacks unlock with growth.
6. **Brutal stakes, fast restart.** No safety net; restart in one click.
7. **Substance over gimmicks.** No NFT, real-money, or "AI for AI's sake" features.

---

## 3. The game, end to end

### 3.1 Player journey
```
CREATE FUND → SANDBOX → CROSS THRESHOLD → ATTACKED → DEFEAT FUNDS → TITLE FLIPS
                 │                              │
                 └──── LIQUIDATED (any time) ───┴──► lose parents' savings → restart
```

| Stage | What the player experiences | Systems active |
|---|---|---|
| 1. Create | Names fund, picks avatar/style, sees intro (skippable) | fund creation, intro screen |
| 2. Sandbox | Trades the real shared market; **invisible** to AI funds and other players | trading, P&L, margin, liquidation, market hours |
| 3. Threshold | Fund NAV crosses the bar → "The market has noticed you." | visibility flip, disclosures begin |
| 4. Attacked | AI funds + players may counter-trade your disclosed exposure | attack logic, confrontation banners |
| 5. Defeating funds | Overtake an AI fund's NAV and hold it → marked DEFEATED | defeat tracker, progress board |
| 6. Win | All funds defeated → title flips, epilogue | victory screen |
| ✖ Lose | Liquidated → cause-of-death screen → restart | liquidation, result card |

### 3.2 Sandbox = "same market, invisible" (decided)
- One simulation. The player trades real prices from tick one and their trades genuinely move the market.
- Until the threshold, the player is **excluded** from: AI decision inputs about individuals, peer attack detection, and public disclosures.
- **Why not a separate practice market (rejected):** two simulations + a fund-transplant "graduation" step is far more code and makes early trades feel fake.
- ⚠️ **Threshold:** NAV ≥ **$25M** (2.5× starting capital). Configurable in `config/game.ts`.
- ⚠️ **Sandbox caveat:** a sandbox player's *aggregate* flow still affects prices (unavoidable and fine). Only *attribution* to them is hidden.

### 3.3 Defeat condition (decided)
A fund is **DEFEATED** when the player's NAV exceeds that fund's NAV **for N consecutive market sessions** (⚠️ N = 5).
- Not a single-tick lead (prevents lucky-spike wins).
- Once defeated, the fund stays marked defeated even if it later recovers ("record of the win"). ❓ Alternative: must *stay* ahead; decide after playtesting.
- Title flips when **all** AI funds are defeated. Progress board shows each fund: `STANDING / DEFEATED` with their NAV vs yours.
- **Defeated funds keep trading** (they're still market participants), they just no longer count toward victory.

### 3.4 Loss condition
Liquidation (margin breach). Server-authoritative — closing the tab cannot dodge it. Cause-of-death is **derived** from trade history (concentration vs leverage vs attack context), never hardcoded.

---

## 4. The market

### 4.1 Hours (decided: markets open/close, not always-on)
- ⚠️ **Two sessions/day**, ~90 min each, UTC-configured (`SESSIONS` in config). Ticks every 5s inside a session.
- **Closed = frozen.** No ticks, no AI decisions, no trades. Simple, cheap (cron-scheduled), and creates anticipation ("Opens in 6h 12m").
- **Overnight gap:** at each open, apply a one-time gap move per ticker using volatility model (bigger than a normal tick). Positions are held through the close → real tension ("am I safe holding this short?").
- World state **persists** across days (NAV, positions, AI fund state).
- The "While you were away" screen (✅ built) becomes the **primary daily catch-up**, not an edge case.

### 4.2 Tickers (decided: diversify, ~20 fictional)
⚠️ Names/parameters are proposals. Keep the data-driven `Company` record; this is content authoring, not code.

| Sector | Tickers (proposed) | Profile |
|---|---|---|
| AI/Tech | NOVA (built), QNTM, HLXS | high vol, narrative-driven |
| Auto | TITN (built), VOLT | cyclical, recall/regulation events |
| Space | ORBT (built) | event-driven, binary launch outcomes |
| Finance | APEX (built), CRWN | low vol, rate-sensitive |
| Consumer | PULS (built), ATLS | steady, low vol |
| Biotech | HLX (built), GENX | extreme vol, binary trial events |
| Energy | EMBR, SOLR | commodity/macro-sensitive |
| Real estate | KEYS, TRUV | rate-sensitive, slow |
| Gaming/Media | PXEL, STRM | hype-driven, launch events |
| Industrial/Defense | FORG, AEGN | contract/regulatory events |
| Retail | MRKT, CART | earnings-driven |

Per-ticker fields (existing + new): `price, previousClose, volatility, liquidity, rateSensitivity, sector, shortInterest?, marketCap`.

### 4.3 Events
- Scripted templates per sector (recall, launch failure, trial result, rate move, contract win, earnings). Each has a shock range and cooldown.
- **Macro events** shock all tickers weighted by `rateSensitivity`.
- **Binary events** (biotech/space) are the "Billions moment" — roughly 50/50 large moves.
- Events are **public the instant they fire** and **hidden until then** (AI funds must not see the schedule — fairness).
- Add ≥3 event templates per new sector so the feed doesn't repeat.

### 4.4 Price impact (✅ built, must be re-tuned)
- Square-root impact: `impact ∝ sqrt(tradeSize / liquidity)`, capped per trade (circuit-breaker analog).
- **Re-tune for many players:** liquidity constants were set for 2–4 players. With an open world, verify (a) one whale still matters, (b) many small same-direction trades don't produce absurd moves. Add a **per-ticker per-tick aggregate impact cap** and **trading halts** on extreme moves.

---

## 5. Trading & risk mechanics (✅ built — reference)

| Mechanic | Rule |
|---|---|
| Long | cash −= amount; position qty = amount / price |
| Short | cash += proceeds; margin reserved (⚠️ 50% of notional) |
| Mark-to-market | NAV = cash + Σ unrealized P&L (pure, non-mutating) |
| Exposure | gross, net, per-ticker; warnings escalate from 50% NAV in one name |
| Liquidation | margin used > available + maintenance threshold → force-close all |
| Execution | orders queue and execute at **next tick** (see §9.3) |

The risk gauge, exposure warning, and margin-proximity cue **must be visible on the main screen** (design gap found in UI review: risk was invisible).

---

## 6. AI hedge funds (the core differentiator)

### 6.1 Roster (⚠️ proposed; names/personalities are placeholders)
Each fund is an **established entity from day one** (NAV ⚠️ $40M–$150M), with a distinct personality and strategy, so beating each one requires a different approach.

| Fund (placeholder) | Personality | Style | Attacks players? |
|---|---|---|---|
| Sterling & Vale | Old-money, condescending | value + macro, slow, big positions | ✅ (top-tier threat) |
| Halden Whitmore | Aggressive shark | short-seller, fades hype | ✅ |
| Crown Meridian | Quant, cold | momentum/statistical | ✅ |
| Ironwood Partners | Cautious grinder | low leverage, defensive | ❓ lighter |
| Redline Capital | Degenerate cowboy | concentrated leverage bets | ✅ (also blows up) |

- ❓ 3–5 funds. Start with **3** for V1 (cost + tuning), add more after playtests.
- Different funds may run on **different models/prompts** (a public "which AI trades best?" leaderboard is a distribution hook).
- AI funds **can be liquidated** like anyone; replace with a new fund/personality → free "AI fund blew up" news moment.

### 6.2 Attack behavior
- "Attack" = **targeted counter-positioning** using public signals. No new combat mechanic.
- An AI fund may attack **only players above the threshold**.
- Each AI fund has **at most one active target** at a time = the player with the highest *threat score* (⚠️ growth rate × NAV above threshold). Re-evaluate on a cooldown (⚠️ every 3 sessions) to avoid flip-flopping.
- Non-target players above the threshold experience only lighter peer pressure.
- Personalities differ in **how** they attack (Shark shorts your crowded names; Quant fades your momentum; Cowboy goes opposite with size).

### 6.3 FAIRNESS CONTRACT (non-negotiable)
AI funds see **only** the allowlist below. Everything else is absent from the input object, not "ignored."

**ALLOWED (allowlist serializer):**
- Current prices, recent price changes per ticker
- Fired public events/news
- Aggregate net flow per ticker (`getNetFlow`)
- Their own full portfolio and cash
- **Delayed public disclosures** ("13F-style"): for funds above the threshold, a coarse filing — top ~3 holdings by sector/ticker, **delayed N sessions** (⚠️ 2). This is what makes attacks *fair and legible*: attackers act on stale public info, like real funds.

**FORBIDDEN (must be provably absent):**
- Any player's exact positions, entry prices, cash, or NAV
- RNG seed / state; any not-yet-fired event or schedule
- Any field added to models later that isn't explicitly allowlisted
- **Player-controlled free text** (fund names, avatars text) — prompt-injection risk. Never pass fund names into an LLM prompt; use stable IDs/sanitized labels.

**Implementation:** `buildAIDecisionInput()` is an **allowlist-based** serializer. Test `aiFairness.test.ts` constructs full state with known player positions and a known upcoming event, and asserts those values are absent. Any PR touching the input type must keep this test green.

### 6.4 Decision pipeline
```
tick → shouldReconsider(input, lastInput)?
        no  → skip (cost saver)
        yes → build allowlisted input → LLM call (JSON only)
                 ├─ valid JSON → validate → apply via SAME engine as players
                 └─ fail/timeout/invalid → fallback: rule-based decision
```
- AI trades through the **same** `openPosition/closePosition/applyTrade` as humans. No special math.
- Output schema: `{ action: buy|short|close|hold, ticker?, dollarAmount?, reasoning, confidence }`. Reasoning ≤ 2 sentences.
- **Validate the LLM output** before applying: known ticker, amount within the fund's limits, no negative/absurd size, leverage cap respected. Reject → fallback.
- Log every decision (`AIDecisionLog`) for the reasoning feed, meta-history, and debugging.
- Only include the **top N most active tickers** in the prompt payload (⚠️ N = 8) to bound cost and latency.

### 6.5 Cost control (design constraint, not afterthought)
- Calls/day ≈ `funds × sessions × reconsider-windows`. Make each term a config value.
- Hard daily **budget cap**: when reached, funds degrade to rule-based decisions (game continues, just less clever).
- Cheaper model for minor funds; stronger model only for the top-tier fund(s).
- Cache/skip when nothing material changed (`shouldReconsider`).

---

## 7. Players vs players

- Open world: all players share the market. No rooms.
- Peer attacks = same primitive: counter-trade using **public** signals (aggregate flow + delayed disclosures of above-threshold funds).
- Below the threshold: invisible (training wheels). Above: visible via disclosures.
- Trash-talk only through controlled game mechanics (reactions/banners), no free text chat in V1 (moderation + injection risk).
- Winning is **not** competitive between humans; survival and defeating AI funds is the goal. Human leaderboards are a secondary social layer.
- ❓ Whether humans can co-operate (shared "syndicates") — post-V1.

---

## 8. Meta layer (cheap, optional, after core works)

- **Milestone story beats** tied to NAV/defeat progress: a friend reaches out, you get an apartment, etc. (❓ confirm). The girlfriend/house beats are best kept for the **victory epilogue**, not unlockable rewards.
- **Fund profile:** name, "Black Sheep" title, peak NAV, best/worst trade, funds defeated, days survived.
- **Shareable result cards** (✅ built): liquidation and milestones — real data, not synthetic virality.
- **AI leaderboard:** live NAV of each AI fund, viewable by anyone (spectator hook, Project-Napoleon-style).
- **Seasons / progression trees (desks, prime brokerage):** *deferred*. Do not build before playtests.

---

## 9. Architecture

### 9.1 Stack (✅ existing)
React + TypeScript + Vite + Tailwind + Zustand · Node/Express (or Fastify) + Prisma + Postgres · shared `/packages/engine` (pure TS, no UI/IO imports) · Vitest.

**Hard rule:** `/packages/engine` has zero UI/network/DB dependencies. It must run identically on client and server and be deterministically testable (seedable PRNG).

### 9.2 Changes required (🔧)
- **Remove `Room`** concept. World is global: single `World` row (clock, session state, seed, config version).
- `Fund`: add `isAI`, `personalityId`, `visible` (post-threshold flag), `titleState`, `defeatedBy?`.
- New tables: `FundDisclosure` (delayed filings), `DefeatProgress` (player × AIFund × consecutive-session lead counter, defeatedAt), `AIDecisionLog` (rename from RivalDecisionLog), `SessionLog` (open/close, gap moves).
- Migrate existing Phase 1–3 data: Prisma migration + `ROLLBACK.md` entry **before** running (touches >3 files/data).

### 9.3 Deterministic trade processing (must-have)
- Single-writer **tick loop** owns the world state. API `POST /trade` **enqueues** an order; it does not mutate state.
- Each tick: sort queued orders by `(receivedAt, orderId)` → apply price impact sequentially → resolve. This prevents same-tick race conditions and "why did my trade get worse impact" bugs.
- Idempotency key per order (prevents double-submit on retry).
- Reconcile client optimistic state with next poll.

### 9.4 Scheduler
- Cron/scheduler opens session → runs ticks every 5s → closes session → snapshots state → applies overnight logic at next open.
- **Crash recovery:** on boot, load last snapshot, determine whether a session should be live, resume (never replay from t=0).
- Polling every 2–3s for clients (websocket upgrade path noted, not built).

### 9.5 Endpoints (target)
`POST /auth/*` · `GET /world/state` · `POST /trade` · `GET /funds/me` · `GET /funds/ai` (public AI board) · `GET /away-summary?since=` · `GET /funds/:id/result-card` · `GET /progress` (defeat board)

---

## 10. Failure modes & fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| LLM call errors / times out | try/catch, timeout (⚠️ 8s) | rule-based decision; log `fallback=true` |
| LLM returns invalid/hostile JSON | schema validation | reject, use rule-based; never apply unvalidated output |
| LLM budget exhausted | daily counter | all AI funds → rule-based until reset |
| Tick loop crashes mid-session | process supervisor + heartbeat | restart from last snapshot; resume session |
| Server down during a session | missed-tick detection | skip missed ticks (do not replay); log a `SessionLog` gap; no player penalty |
| Duplicate trade submit | idempotency key | ignore second |
| Price hits ≤ 0 / NaN | invariant check per tick | clamp to floor, halt ticker, alert |
| Extreme move / manipulation | per-tick move threshold | **trading halt** for that ticker for M ticks |
| Wash-trading / multi-accounting to move thin stocks | per-account flow limits, impact caps, account-age gating on impact | cap effective impact per account per session |
| Prompt injection via fund name/text | fund text never enters prompts | IDs/sanitized labels only |
| All AI funds liquidated | check each session | spawn replacement fund (new personality, seeded NAV) |
| AI NAV so high defeat is impossible | telemetry | config-tunable NAV drift/decay; soft cap |
| Player offline through a big event | away-summary | shown on return; positions already resolved server-side |
| DB unavailable | health check | read-only degraded mode; queue rejected with clear error |
| Migration failure | pre-migration backup | `ROLLBACK.md` steps |

---

## 11. Tuning parameters (all in `config/game.ts`, all ⚠️)

| Param | Start value | Tune by watching |
|---|---|---|
| Starting capital | $10M | early-game pacing |
| Visibility threshold | NAV ≥ $25M | time-to-threshold (aim: 2–5 sessions for a decent player) |
| Short margin | 50% | liquidation frequency |
| Sessions/day, length | 2 × 90 min | when people actually log in |
| Tick interval | 5s | UI feel vs server load |
| AI fund NAV range | $40M–$150M | is defeat achievable but earned? |
| Defeat lead duration | 5 sessions | lucky vs earned wins |
| Disclosure delay | 2 sessions | attack fairness/legibility |
| AI reconsider cadence | ~every 10 ticks, gated | cost vs liveliness |
| Attack target cooldown | 3 sessions | flip-flop vs responsiveness |
| Max single-trade impact | 8% | market stability |
| Daily LLM budget | set from real cost | spend |

**Balance is the long pole.** It's a game-design problem solved by playtests, not by more code. Instrument everything (§13).

---

## 12. Build status

| Area | Status |
|---|---|
| Pure engine: market, portfolio, events, impact, liquidation | ✅ |
| Terminal UI, positions, ticker, news, risk warnings | ✅ (risk gauge on main screen: 🔧 verify) |
| LLM rival + fallback + fairness guardrail (single rival) | ✅ (needs generalizing to N funds) |
| Backend, auth, persistence, tick loop, away-summary | ✅ (room-based) |
| Liquidation screen + shareable cards | ✅ |
| Rooms removed → global world | 🔧 |
| Market hours + overnight gap | 🔧 |
| Sandbox invisibility + threshold | 🔧 |
| Multiple AI funds + disclosures | 🔧 |
| Defeat tracking + progress board | 🔧 |
| Lore/intro/end states | 🔧 |
| Expanded tickers/events | 🔧 |

---

## 13. Roadmap

**Workflow contract (per `docs/ai/`):** each step = one logical change. Agent reads HANDOVER/CONSTRAINTS/ARCHITECTURE/FLOW → outputs **PLAN first** → waits for approval → implements → reports **CHANGED / WHY / VERIFY / NOT VERIFIED**. Log non-obvious choices in `DECISIONS.md`; write `ROLLBACK.md` before any change touching >3 files or data.

### Phase A — Re-platform to a global, scheduled world
| # | Change | Done when |
|---|---|---|
| A1 | Remove rooms → single global world (schema + API + client) | one world row; two accounts see same market; old room data migrated with rollback |
| A2 | Deterministic trade queue (§9.3) | concurrent orders resolve in stable order; idempotency test passes |
| A3 | Session scheduler + market hours + frozen-when-closed | ticks only in-session; countdown UI; crash-recovery test |
| A4 | Overnight gap at open | gap applied once per open; positions carried; test on determinism |

### Phase B — Growth gating
| # | Change | Done when |
|---|---|---|
| B1 | `visible` flag + threshold check (server-side) | crossing threshold flips flag; sandbox players absent from attack inputs |
| B2 | Public disclosure system (delayed filings) | above-threshold funds produce delayed coarse filings |
| B3 | Impact re-tune for many players + per-tick cap + halts | simulation script with 100 bots shows sane prices |

### Phase C — Multiple AI funds
| # | Change | Done when |
|---|---|---|
| C1 | Generalize rival → `AIFund` with personality config | 1 fund still works identically |
| C2 | Allowlist input builder + `aiFairness.test.ts` for N funds | test proves forbidden data absent |
| C3 | Add funds 2–3 with distinct strategies + rule-based fallbacks | each fund shows distinct behavior in logs |
| C4 | Attack logic: threat score, single-target, cooldown | AI funds only target visible players; banners fire |
| C5 | Cost controls: reconsider guard, top-N tickers, daily budget cap | budget exhaustion degrades gracefully |

### Phase D — Win/lose loop
| # | Change | Done when |
|---|---|---|
| D1 | Defeat tracker + progress board | lead-for-N-sessions marks DEFEATED; persists |
| D2 | Victory screen + title flip | all defeated → flip + epilogue |
| D3 | Lore: intro, liquidation copy, banners | copy bank in place; intro skippable |

### Phase E — Content & polish
| # | Change | Done when |
|---|---|---|
| E1 | Expand to ~20 tickers + sector events | each new sector has ≥3 event templates |
| E2 | Public AI leaderboard + fund profile | live AI NAVs viewable |
| E3 | Milestone story beats (❓ confirm) | beats fire at defined NAV/defeat milestones |

### Gate: PLAYTEST (after Phase C, before D/E scale-up)
5+ real players × 2 sessions. Observe: Do they **feel** the AI rivalry? Does the attack banner change behavior? Do liquidated players understand why? Is defeating fund #1 achievable but earned? Tune §11 values from this. **Do not build seasons/progression trees before this gate.**

### Telemetry to add early (cheap, essential)
Time-to-threshold, liquidation cause distribution, per-fund win/loss vs players, LLM fallback rate, cost/day, session attendance, drop-off stage.

---

## 14. Testing strategy

- **Engine unit tests:** determinism (same seed → same result), no negative prices, volatility ordering, short-side sign correctness (4 cases), margin/liquidation, impact cap.
- **Fairness test:** forbidden fields absent from AI input (§6.3).
- **Trade queue tests:** ordering, idempotency, concurrency.
- **Scheduler tests:** session open/close, gap, crash-recovery.
- **Simulation harness:** N scripted bot players + AI funds run for many sessions; assert no NaN, no stuck halts, price bounds, AI NAV stays in range.
- **Manual feel-checks:** news event on an open position is legible; liquidation cause is understandable.

---

## 15. Non-goals (do NOT build in V1)

Real money/crypto/NFTs · options and complex derivatives · free-text chat · separate sandbox simulation · seasons/progression trees/desks · websockets (polling is fine) · sharding/multi-world · AI-generated avatars/voice · mobile native app.

---

## 16. Open decisions ❓

1. Villain-free naming: final names for the AI funds (placeholders above).
2. Number of AI funds at launch (recommend 3).
3. Post-victory title (what "Black Sheep" becomes).
4. Must the player *stay* ahead of a defeated fund, or is defeat permanent?
5. Milestone story beats: in or out for V1?
6. Session times (depends on when your audience plays).
7. Do minor AI funds attack players, or only top-tier ones?

---

## 17. Glossary

**NAV** — Net Asset Value: cash + unrealized P&L. · **Long/Short** — bet on rise/fall. · **Margin** — collateral reserved for shorts/leverage. · **Liquidation** — forced close when margin is breached. · **Net flow** — signed sum of recent buy/sell pressure per ticker. · **Price impact** — how much a trade moves price (sqrt model). · **Disclosure** — delayed public filing of a fund's coarse holdings. · **Threshold** — NAV level at which a player becomes visible/attackable. · **Defeated** — an AI fund overtaken by the player for N consecutive sessions. · **Gap** — one-time price jump at session open. · **Halt** — temporary trading freeze on a ticker after an extreme move.
