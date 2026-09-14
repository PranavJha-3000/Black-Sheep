import {
  applyEvent,
  applyTrade,
  createInitialMarket,
  mulberry32,
  tickMarket,
} from '@black-sheep/engine/market';
import { generateEvent, initialScheduler, maybeFireScriptedEvent, type SchedulerState } from '@black-sheep/engine/events';
import {
  checkLiquidation,
  deriveCauseOfDeath,
  INITIAL_MARGIN_RATE,
  liquidateFund,
  markToMarket,
  peakNav,
} from '@black-sheep/engine/portfolio';
import {
  applyRivalDecision,
  buildDecisionInput,
  detectConfrontation,
  makeRandomDecision,
  RIVAL_DECISION_TICKS,
  RIVAL_NAME,
  type RivalDecision,
  type RivalFund,
  type RivalLastDecision,
} from '@black-sheep/engine/rival';
import { makeLLMDecision } from '@black-sheep/engine/rivalLLM';
import type {
  Direction,
  MarketEvent,
  MarketState,
  Position,
  Ticker,
} from '@black-sheep/engine/types';
import { prisma } from './db';

/**
 * The persistent game world.
 *
 * One in-memory World per active room. The market and the rival fund live
 * HERE now (not in a browser), so the world keeps ticking while nobody is
 * connected. The engine is the shared package — the server only orchestrates:
 * tick → persist periodic snapshot → rival decides → persist deltas.
 */

// Engine starting capital lives client-side (gameStore) today; the server
// needs the same number to seed funds. A config constant, not engine logic.
const STARTING_CAPITAL = 10_000_000;
const TICK_MS = 5_000;
/** Full market snapshots every N engine ticks (periodic, NOT every tick). */
const SNAPSHOT_EVERY_TICKS = 3;
const EVENT_BUFFER = 60;
const RNG_SEED_SALT = 0x9e3779b9;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

interface World {
  roomId: number;
  market: MarketState;
  scheduler: SchedulerState;
  events: MarketEvent[];
  rivalFundId: number;
  rivalFund: RivalFund;
  /** One in-flight rival LLM decision at a time (same guard as the client). */
  rivalPending: boolean;
  rngSeed: number;
}

const worlds = new Map<number, World>();

/** Accessor for other server modules that need the live market (peak NAV tracking). */
export function getWorld(roomId: number): World | undefined {
  return worlds.get(roomId);
}

/**
 * Per-room serialization for anything that mutates a world's in-memory market
 * and mirrors it to Postgres (tick, player trade, rival decision mutation).
 *
 * The world clock only ticks a room once per interval, but HTTP trade handlers
 * and rival LLM resolutions run concurrently with it. Without this lock a
 * player trade could apply price impact, then be silently clobbered by an
 * interleaved tick (losing the move for every observer) — or two writers
 * could double-spend cash. Waiting on the previous op's settlement (even on
 * failure, via then(fn, fn)) makes each room effectively single-writer.
 */
const roomLocks = new Map<number, Promise<unknown>>();
export function withWorldLock<T>(roomId: number, fn: () => Promise<T>): Promise<T> {
  const prev = roomLocks.get(roomId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow into the stored chain so a rejected op doesn't poison it.
  roomLocks.set(roomId, next.catch(() => undefined));
  return next;
}

function positionKey(ticker: string, direction: string, entryTimestamp: number): string {
  return `${ticker}:${direction}:${entryTimestamp}`;
}

function enginePositionFromRow(row: {
  id: number;
  ticker: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  entryTimestamp: Date;
}): Position {
  const direction: Direction = row.direction === 'short' ? 'short' : 'long';
  return {
    id: `db-${row.id}`,
    ticker: row.ticker as Ticker,
    direction,
    quantity: row.quantity,
    entryPrice: row.entryPrice,
    entryTimestamp: row.entryTimestamp.getTime(),
    // Not persisted: reconstructed from the engine's own rule (Reg-T 50%).
    marginReserved: direction === 'short' ? INITIAL_MARGIN_RATE * row.quantity * row.entryPrice : 0,
  };
}

/** Build an engine Fund from DB position rows (shared shape with rooms.ts engineFundFromRows). */
function engineFundFromRows(
  cash: number,
  startingCapital: number,
  rows: Array<{
    id: number;
    ticker: string;
    direction: string;
    quantity: number;
    entryPrice: number;
    entryTimestamp: Date;
  }>,
): { cash: number; positions: Position[]; realizedPnL: number; startingCapital: number; history: { timestamp: number; nav: number }[] } {
  return {
    cash,
    positions: rows.map(enginePositionFromRow),
    realizedPnL: 0,
    startingCapital,
    history: [],
  };
}

function realizedOfClosed(row: {
  direction: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
}): number {
  if (row.exitPrice === null) return 0;
  const raw = (row.exitPrice - row.entryPrice) * row.quantity;
  return row.direction === 'long' ? raw : -raw;
}

/** Rebuild the rival's engine fund from persisted rows (DB stores no engine objects). */
async function rebuildRivalFund(fundId: number, market: MarketState): Promise<RivalFund> {
  const fund = await prisma.fund.findUniqueOrThrow({ where: { id: fundId } });
  const open = await prisma.position.findMany({ where: { fundId, closedAt: null } });
  const closed = await prisma.position.findMany({ where: { fundId, closedAt: { not: null } } });
  const lastDecisionRow = await prisma.rivalDecisionLog.findFirst({
    where: { roomId: fund.roomId },
    orderBy: { timestamp: 'desc' },
  });

  const positions = open.map(enginePositionFromRow);
  const realizedPnL = closed.reduce((sum, r) => sum + realizedOfClosed(r), 0);
  const nav = Math.max(
    1,
    markToMarket(
      { cash: fund.cash, positions, realizedPnL, startingCapital: fund.startingCapital, history: [] },
      market,
    ).nav,
  );

  return {
    cash: fund.cash,
    positions,
    realizedPnL,
    startingCapital: fund.startingCapital,
    history: [{ timestamp: market.timestamp, nav }],
    personality: 'contrarian',
    lastDecision: lastDecisionRow
      ? {
          action: lastDecisionRow.action as RivalDecision['action'],
          ticker: (lastDecisionRow.ticker ?? undefined) as Ticker | undefined,
          reasoning: lastDecisionRow.reasoning,
          confidence: lastDecisionRow.confidence ?? 0.7,
          fillPrice: lastDecisionRow.fillPrice ?? undefined,
          realizedPnL: lastDecisionRow.realizedPnL ?? undefined,
          timestamp: lastDecisionRow.tickCountAt ?? 0,
        }
      : null,
  };
}

/** Load a room's world from persisted state, or bootstrap a fresh one. */
export async function ensureWorld(roomId: number): Promise<World> {
  const existing = worlds.get(roomId);
  if (existing) return existing;

  const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
  let rival = await prisma.fund.findFirst({ where: { roomId, userId: null } });
  if (!rival) {
    rival = await prisma.fund.create({
      data: { roomId, userId: null, name: RIVAL_NAME, cash: STARTING_CAPITAL, startingCapital: STARTING_CAPITAL },
    });
  }

  // Reconstruct from the latest full snapshot — never replay from t=0.
  const latest = await prisma.marketTick.findFirst({ where: { roomId }, orderBy: { timestamp: 'desc' } });
  let market: MarketState;
  let scheduler: SchedulerState;
  if (latest) {
    const snap = JSON.parse(latest.snapshotJson) as { market: MarketState; scheduler: SchedulerState };
    market = snap.market;
    scheduler = snap.scheduler;
  } else {
    market = createInitialMarket();
    scheduler = initialScheduler(15);
  }

  const eventRows = await prisma.marketEventLog.findMany({
    where: { roomId },
    orderBy: { timestamp: 'desc' },
    take: 30,
  });
  const events: MarketEvent[] = eventRows.map((r) => ({
    id: `evtlog-${r.id}`,
    type: r.type as MarketEvent['type'],
    ticker: (r.ticker ?? undefined) as Ticker | undefined,
    headline: r.headline,
    priceImpactPercent: r.priceImpactPercent,
    // Log rows are wall-clock; engine timestamps are tick units. Events do
    // not participate in flow-lookback math, so the unit mismatch is cosmetic.
    timestamp: r.timestamp.getTime(),
  }));

  const world: World = {
    roomId,
    market,
    scheduler,
    events,
    rivalFundId: rival.id,
    rivalFund: await rebuildRivalFund(rival.id, market),
    rivalPending: false,
    rngSeed: (room.id * RNG_SEED_SALT) >>> 0,
  };
  worlds.set(roomId, world);
  return world;
}

/**
 * Advance one room's world by one engine tick, persisting as we go.
 * (Same sequencing as the client store's tick(), but every write lands in
 * Postgres so the world survives restarts and runs with no clients attached.)
 */
async function tickWorld(w: World): Promise<void> {
  const rng = mulberry32((w.rngSeed ^ Math.imul(w.market.tickCount + 1, 0x85ebca6b)) >>> 0);
  let next = tickMarket(w.market, w.rngSeed);
  const scripted = maybeFireScriptedEvent(next, w.scheduler, rng);
  let evt: MarketEvent | null = scripted.event;
  w.scheduler = scripted.next;
  if (!evt) evt = generateEvent(next, rng);
  if (evt) next = applyEvent(next, evt) as typeof next;
  w.market = next;

  // Track all-time high NAV for every fund using the new market prices.
  // Done before liquidation so the peak captures the pre-liquidation state.
  await trackPeakNav(w);

  // Server-authoritative liquidation: after prices move, check every player
  // fund (not the rival) for margin breach. A player closing their tab cannot
  // dodge this — it runs entirely on the server during the unattended tick.
  await liquidatePlayerFunds(w);

  if (evt) {
    w.events = [evt, ...w.events].slice(0, EVENT_BUFFER);
    await prisma.marketEventLog.create({
      data: {
        roomId: w.roomId,
        type: evt.type,
        ticker: evt.ticker ?? null,
        headline: evt.headline,
        priceImpactPercent: evt.priceImpactPercent,
        tickCountAt: next.tickCount,
      },
    });
  }

  // Periodic FULL snapshot — not every tick — so "what happened while you
  // were away" reconstructs from the last snapshot, never a replay from t=0.
  if (next.tickCount % SNAPSHOT_EVERY_TICKS === 0) {
    await prisma.marketTick.create({
      data: {
        roomId: w.roomId,
        snapshotJson: JSON.stringify({ market: next, scheduler: w.scheduler }),
      },
    });
  }

  // Rival decision cycle (Phase 2, now server-side): every 10 engine ticks,
  // non-blocking, one in flight at a time.
  if (next.tickCount > 0 && next.tickCount % RIVAL_DECISION_TICKS === 0 && !w.rivalPending) {
    w.rivalPending = true;
    void decideRival(w)
      .catch((err) => console.error(`[world] room ${w.roomId} rival decision failed`, err))
      .finally(() => {
        w.rivalPending = false;
      });
  }
}

/**
 * Update the all-time high NAV for every fund in the room. Called after each
 * market tick so the peak captures price movement between player trades.
 * Cheap: one read + at most one write per fund per tick.
 */
async function trackPeakNav(w: World): Promise<void> {
  const funds = await prisma.fund.findMany({ where: { roomId: w.roomId } });
  for (const f of funds) {
    const open = await prisma.position.findMany({ where: { fundId: f.id, closedAt: null } });
    const ef = engineFundFromRows(f.cash, f.startingCapital, open);
    const nav = markToMarket(ef, w.market).nav;
    if (nav > f.peakNav) {
      await prisma.fund.update({ where: { id: f.id }, data: { peakNav: nav } });
    }
  }
}

/**
 * Check every player fund in the room for liquidation. Server-authoritative:
 * runs during the unattended tick loop, so a player closing their tab cannot
 * dodge a margin call.
 *
 * For each non-rival, non-already-liquidated fund: reconstruct the engine Fund
 * from DB rows, run checkLiquidation against the current market. If atRisk,
 * force-close all positions at market price, mark the fund liquidated, compute
 * the cause of death, look for rival context, and write a LiquidationLog.
 */
async function liquidatePlayerFunds(w: World): Promise<void> {
  const playerFunds = await prisma.fund.findMany({
    where: { roomId: w.roomId, userId: { not: null }, liquidated: false },
  });

  for (const fund of playerFunds) {
    const openRows = await prisma.position.findMany({
      where: { fundId: fund.id, closedAt: null },
    });
    if (openRows.length === 0) continue;

    const engineFund = engineFundFromRows(fund.cash, fund.startingCapital, openRows);
    const liq = checkLiquidation(engineFund, w.market);
    if (!liq.atRisk) continue;

    // Force-close every open position at the current market price.
    const closed = liquidateFund(engineFund, w.market);
    const cause = deriveCauseOfDeath(engineFund, w.market);
    const peak = fund.peakNav > 0 ? fund.peakNav : peakNav(engineFund);
    const tickCountAt = w.market.tickCount;
    const durationTicks = tickCountAt; // ticks since fund creation (t=0 bootstrap)

    // Look for rival context: recent confrontational decisions against the
    // player's now-closed positions.
    const rivalContext = await computeRivalContext(w.roomId, engineFund.positions, tickCountAt);

    await prisma.$transaction([
      // Mark every open position as closed at market price.
      ...openRows.map((p) =>
        prisma.position.update({
          where: { id: p.id },
          data: {
            closedAt: new Date(),
            exitPrice: w.market.companies[p.ticker]?.price ?? p.entryPrice,
          },
        }),
      ),
      // Update fund cash to the post-liquidation value and flag it.
      prisma.fund.update({
        where: { id: fund.id },
        data: {
          cash: closed.cash,
          liquidated: true,
        },
      }),
      prisma.liquidationLog.create({
        data: {
          roomId: w.roomId,
          fundId: fund.id,
          startingCapital: fund.startingCapital,
          peakNav: peak,
          finalNav: markToMarket(closed, w.market).nav,
          cause,
          rivalContext,
          tickCountAt,
          durationTicks,
        },
      }),
    ]);

    console.log(`[world] room ${w.roomId} fund ${fund.id} LIQUIDATED — ${cause}${rivalContext ? ` | rival: ${rivalContext}` : ''}`);
  }
}

/**
 * Look back at recent rival decisions to see if any were confrontational
 * against the player's positions at the moment of liquidation. Returns a
 * human-readable context line, or null when the liquidation was purely the
 * player's own leverage.
 *
 * The lookback window is the last 6 rival decisions (≈60 engine ticks) —
 * close enough to be causally plausible, far enough to catch the relevant
 * "the rival just went short what you're long" moments.
 */
async function computeRivalContext(
  roomId: number,
  playerPositions: Position[],
  tickCountAt: number,
): Promise<string | null> {
  if (playerPositions.length === 0) return null;

  const recentDecisions = await prisma.rivalDecisionLog.findMany({
    where: { roomId, tickCountAt: { lte: tickCountAt } },
    orderBy: { timestamp: 'desc' },
    take: 6,
  });

  // Replay the most recent decisions first; surface the first confrontation.
  for (const row of recentDecisions) {
    if (!row.ticker) continue;
    const lastDecision: RivalLastDecision = {
      action: row.action as RivalLastDecision['action'],
      ticker: row.ticker,
      reasoning: row.reasoning,
      confidence: row.confidence ?? 0.7,
      timestamp: row.tickCountAt ?? 0,
      fillPrice: row.fillPrice ?? undefined,
      realizedPnL: row.realizedPnL ?? undefined,
    };
    const evt = detectConfrontation(playerPositions, lastDecision);
    if (evt) {
      const dt = tickCountAt - (row.tickCountAt ?? 0);
      const timing = dt <= 2 ? 'moments after' : dt <= 10 ? 'shortly after' : 'after';
      const dirWord = evt.kind === 'opposite'
        ? (lastDecision.action === 'short' ? `went short ${evt.ticker} — directly against your position` : `went long ${evt.ticker} — directly against your short`)
        : `banked +$${Math.round((evt.rivalGain ?? 0) / 1000)}K on ${evt.ticker} while you were underwater`;
      return `Liquidated ${timing} ${RIVAL_NAME} ${dirWord}`;
    }
  }
  return null;
}

/** Persist the rival's state delta after a decision (fund cash + positions + log). */
async function persistRivalState(w: World, before: RivalFund, after: RivalFund, decision: RivalDecision): Promise<void> {
  const beforeKeys = new Set(before.positions.map((p) => positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const afterKeys = new Set(after.positions.map((p) => positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const added = after.positions.filter((p) => !beforeKeys.has(positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const removed = before.positions.filter((p) => !afterKeys.has(positionKey(p.ticker, p.direction, p.entryTimestamp)));

  await prisma.$transaction([
    prisma.fund.update({ where: { id: w.rivalFundId }, data: { cash: after.cash } }),
    ...added.map((p) =>
      prisma.position.create({
        data: {
          fundId: w.rivalFundId,
          ticker: p.ticker,
          direction: p.direction,
          quantity: p.quantity,
          entryPrice: p.entryPrice,
          entryTimestamp: new Date(p.entryTimestamp),
        },
      }),
    ),
    ...removed.map((p) =>
      prisma.position.updateMany({
        where: {
          fundId: w.rivalFundId,
          ticker: p.ticker,
          direction: p.direction,
          entryTimestamp: new Date(p.entryTimestamp),
          closedAt: null,
        },
        data: {
          closedAt: new Date(),
          exitPrice: w.market.companies[p.ticker]?.price ?? p.entryPrice,
        },
      }),
    ),
    prisma.rivalDecisionLog.create({
      data: {
        roomId: w.roomId,
        fundId: w.rivalFundId,
        action: decision.action,
        ticker: decision.ticker ?? null,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        // Execution telemetry comes from what actually happened (the stamped
        // lastDecision), not the raw choice — a rejected trade logs no fill.
        fillPrice: after.lastDecision?.fillPrice ?? null,
        realizedPnL: after.lastDecision?.realizedPnL ?? null,
        tickCountAt: w.market.tickCount,
      },
    }),
  ]);
}

/** The Phase 2 rival decision pipeline, now running on the server. */
async function decideRival(w: World): Promise<void> {
  const before = w.rivalFund;
  const input = buildDecisionInput(before, w.market, w.events, w.market.recentFlow);
  // LLM when a key exists; the deterministic twin otherwise. makeLLMDecision
  // also self-falls-back to the twin on any call/parse failure.
  //
  // The LLM call is deliberately OUTSIDE the room lock (multi-second latency
  // must not stall the market). The mutation and persistence below re-acquire
  // the lock and re-read the current market so a trade/decision that resolved
  // against stale prices is never applied on top of fresher ones.
  const decision: RivalDecision = ANTHROPIC_API_KEY
    ? await makeLLMDecision(input, {
        url: ANTHROPIC_URL,
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      })
    : makeRandomDecision(input);

  await withWorldLock(w.roomId, async () => {
    let market = w.market;
    // The rival moves prices exactly like the player: applyTrade first.
    if ((decision.action === 'buy' || decision.action === 'short') && decision.ticker && decision.dollarAmount) {
      const impacted = applyTrade(
        market,
        decision.ticker,
        decision.dollarAmount,
        decision.action === 'buy' ? 'buy' : 'sell',
      );
      market = { ...market, companies: impacted.companies, recentFlow: impacted.recentFlow };
    }

    const after = applyRivalDecision(before, decision, market);
    w.market = market;
    w.rivalFund = after;
    await persistRivalState(w, before, after, decision);
  });
}

/** Tick every active room. Sequential on purpose: single-flight per interval. */
async function tickAllActiveRooms(): Promise<void> {
  try {
    const rooms = await prisma.room.findMany({ where: { status: 'active' }, select: { id: true } });
    for (const room of rooms) {
      try {
        const w = worlds.get(room.id) ?? (await ensureWorld(room.id));
        // Serialize against concurrent trade handlers for this room.
        await withWorldLock(room.id, () => tickWorld(w));
      } catch (err) {
        console.error(`[world] room ${room.id} tick failed`, err);
      }
    }
  } catch (err) {
    console.error('[world] tick pass failed', err);
  }
}

/** Start the world clock. Returns a stop function (tests / graceful shutdown). */
export function startWorldLoop(): () => void {
  const timer = setInterval(() => {
    void tickAllActiveRooms();
  }, TICK_MS);
  console.log(`[world] clock started - ticking every ${TICK_MS}ms`);
  return () => clearInterval(timer);
}


