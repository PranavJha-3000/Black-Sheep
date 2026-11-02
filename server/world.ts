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
  liquidateFund,
  markToMarket,
  peakNav,
} from '@black-sheep/engine/portfolio';
import {
  applyRivalDecision,
  buildDecisionInput,
  makeRandomDecision,
  RIVAL_NAME,
  type RivalDecision,
  type RivalFund,
} from '@black-sheep/engine/rival';
import { makeLLMDecision } from '@black-sheep/engine/rivalLLM';
import type { MarketEvent, MarketState, Ticker } from '@black-sheep/engine/types';
import { prisma } from './db';
import {
  enginePositionFromRow,
  engineFundFromRows,
  parseWorldSnapshot,
  positionKey,
  realizedOfClosed,
  resolveWorldSeed,
  shouldFundDecide,
  singleFlight,
} from './worldCore';
import {
  EVENT_BUFFER,
  LIVE_WORLD_NAME,
  SNAPSHOT_EVERY_TICKS,
  STARTING_CAPITAL,
  TICK_INTERVAL_MS,
  WORLD_SEED,
} from '../config/game';

/**
 * The persistent live world.
 *
 * One in-memory World — the single seeded world named LIVE_WORLD_NAME (D-016).
 * The market and every AI fund live HERE, so the world keeps ticking while
 * nobody is watching. Humans only observe it through GET /world/state. The
 * engine is the shared package — the server only orchestrates:
 * tick → persist periodic snapshot → funds decide → persist deltas.
 */

// Starting capital, tick interval, snapshot cadence, the event buffer and the
// default seed come from config/game.ts — no engine-logic tuning constants live here.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';

interface World {
  worldId: number;
  name: string;
  /** Persisted at creation; a restart resumes the same RNG stream (D-018). */
  seed: number;
  market: MarketState;
  scheduler: SchedulerState;
  events: MarketEvent[];
  rivalFundId: number;
  rivalFund: RivalFund;
  /** One in-flight LLM decision at a time. */
  rivalPending: boolean;
  /** A liquidated fund stays visible but never decides again (D-019). */
  rivalLiquidated: boolean;
}

let live: World | undefined;

/** The loaded live world, or undefined before the first successful ensureLiveWorld(). */
export function getLiveWorld(): World | undefined {
  return live;
}

/**
 * Serialization for anything that mutates the world's in-memory market and
 * mirrors it to Postgres (tick, fund decision mutation).
 *
 * The world clock ticks once per interval, but LLM decisions resolve
 * concurrently with it. Without this lock a decision could apply price impact,
 * then be silently clobbered by an interleaved tick. Waiting on the previous
 * op's settlement (even on failure, via then(fn, fn)) makes the world
 * single-writer.
 */
let worldLock: Promise<unknown> = Promise.resolve();
export function withWorldLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = worldLock.then(fn, fn);
  // Swallow into the stored chain so a rejected op doesn't poison it.
  worldLock = next.catch(() => undefined);
  return next;
}

/** Rebuild the rival's engine fund from persisted rows (DB stores no engine objects). */
async function rebuildRivalFund(fundId: number, market: MarketState): Promise<RivalFund> {
  const fund = await prisma.fund.findUniqueOrThrow({ where: { id: fundId } });
  const open = await prisma.position.findMany({ where: { fundId, closedAt: null } });
  const closed = await prisma.position.findMany({ where: { fundId, closedAt: { not: null } } });
  const lastDecisionRow = await prisma.rivalDecisionLog.findFirst({
    where: { fundId },
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

/**
 * Load the live world from persisted state, or bootstrap it on first boot.
 * A corrupt snapshot throws (parseWorldSnapshot) rather than silently starting
 * a fresh market over a world observers have been watching. Concurrent callers
 * (a tick and a poll on boot) share one load, so the world is never forked.
 */
export const ensureLiveWorld: () => Promise<World> = singleFlight(loadLiveWorld);

async function loadLiveWorld(): Promise<World> {

  const envSeed = process.env.WORLD_SEED;
  let row = await prisma.world.findUnique({ where: { name: LIVE_WORLD_NAME } });
  if (row) {
    const { envIgnored } = resolveWorldSeed(row.seed, envSeed, WORLD_SEED);
    if (envIgnored) {
      console.warn(`[world] WORLD_SEED=${envSeed} ignored: world "${row.name}" keeps its persisted seed ${row.seed}`);
    }
  } else {
    const { seed } = resolveWorldSeed(null, envSeed, WORLD_SEED);
    row = await prisma.world.upsert({
      where: { name: LIVE_WORLD_NAME },
      create: { name: LIVE_WORLD_NAME, seed },
      update: {},
    });
  }
  const worldId = row.id;

  let rival = await prisma.fund.findFirst({ where: { worldId }, orderBy: { id: 'asc' } });
  if (!rival) {
    rival = await prisma.fund.create({
      data: { worldId, name: RIVAL_NAME, cash: STARTING_CAPITAL, startingCapital: STARTING_CAPITAL },
    });
  }

  // Reconstruct from the latest full snapshot — never replay from t=0.
  const latest = await prisma.marketTick.findFirst({ where: { worldId }, orderBy: { timestamp: 'desc' } });
  let market: MarketState;
  let scheduler: SchedulerState;
  if (latest) {
    ({ market, scheduler } = parseWorldSnapshot(latest.snapshotJson));
  } else {
    market = createInitialMarket();
    scheduler = initialScheduler();
  }

  const eventRows = await prisma.marketEventLog.findMany({
    where: { worldId },
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

  live = {
    worldId,
    name: row.name,
    seed: row.seed,
    market,
    scheduler,
    events,
    rivalFundId: rival.id,
    rivalFund: await rebuildRivalFund(rival.id, market),
    rivalPending: false,
    rivalLiquidated: rival.liquidated,
  };
  return live;
}

/**
 * Advance the world by one engine tick, persisting as we go, so the world
 * survives restarts and runs with nobody watching.
 */
async function tickWorld(w: World): Promise<void> {
  const rng = mulberry32((w.seed ^ Math.imul(w.market.tickCount + 1, 0x85ebca6b)) >>> 0);
  let next = tickMarket(w.market, w.seed);
  const scripted = maybeFireScriptedEvent(next, w.scheduler, rng);
  let evt: MarketEvent | null = scripted.event;
  w.scheduler = scripted.next;
  if (!evt) evt = generateEvent(next, rng);
  if (evt) next = applyEvent(next, evt) as typeof next;
  w.market = next;

  // Track all-time high NAV for every fund using the new market prices.
  // Done before liquidation so the peak captures the pre-liquidation state.
  await trackPeakNav(w);

  // Server-authoritative liquidation: after prices move, check every fund
  // for margin breach.
  await liquidateFunds(w);

  if (evt) {
    w.events = [evt, ...w.events].slice(0, EVENT_BUFFER);
    await prisma.marketEventLog.create({
      data: {
        worldId: w.worldId,
        type: evt.type,
        ticker: evt.ticker ?? null,
        headline: evt.headline,
        priceImpactPercent: evt.priceImpactPercent,
        tickCountAt: next.tickCount,
      },
    });
  }

  // Periodic FULL snapshot — not every tick — so a restart reconstructs from
  // the last snapshot, never a replay from t=0.
  if (next.tickCount % SNAPSHOT_EVERY_TICKS === 0) {
    await prisma.marketTick.create({
      data: {
        worldId: w.worldId,
        snapshotJson: JSON.stringify({ market: next, scheduler: w.scheduler }),
      },
    });
  }

  // Decision cycle: on the cadence tick, non-blocking, one in flight at a
  // time, never for a liquidated fund.
  if (shouldFundDecide(next.tickCount, w.rivalPending, w.rivalLiquidated)) {
    w.rivalPending = true;
    void decideRival(w)
      .catch((err) => console.error(`[world] ${w.name} decision failed`, err))
      .finally(() => {
        w.rivalPending = false;
      });
  }
}

/**
 * Update the all-time high NAV for every fund in the world. Called after each
 * market tick so the peak captures price movement between decisions.
 * Cheap: one read + at most one write per fund per tick.
 */
async function trackPeakNav(w: World): Promise<void> {
  const funds = await prisma.fund.findMany({ where: { worldId: w.worldId } });
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
 * Check every fund in the world for liquidation (D-019: AI funds can die).
 *
 * For each not-yet-liquidated fund: reconstruct the engine Fund from DB rows,
 * run checkLiquidation against the current market. If atRisk, force-close all
 * positions at market price, mark the fund liquidated, compute the cause of
 * death, and write a LiquidationLog. A liquidated fund stays in the world for
 * observers but stops deciding.
 */
async function liquidateFunds(w: World): Promise<void> {
  const funds = await prisma.fund.findMany({
    where: { worldId: w.worldId, liquidated: false },
  });

  for (const fund of funds) {
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
          worldId: w.worldId,
          fundId: fund.id,
          startingCapital: fund.startingCapital,
          peakNav: peak,
          finalNav: markToMarket(closed, w.market).nav,
          cause,
          rivalContext: null,
          tickCountAt,
          durationTicks,
        },
      }),
    ]);

    if (fund.id === w.rivalFundId) {
      w.rivalFund = { ...w.rivalFund, cash: closed.cash, positions: closed.positions };
      w.rivalLiquidated = true;
    }

    console.log(`[world] ${w.name} fund ${fund.id} LIQUIDATED — ${cause}`);
  }
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
        worldId: w.worldId,
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
  // The LLM call is deliberately OUTSIDE the world lock (multi-second latency
  // must not stall the market). The mutation and persistence below re-acquire
  // the lock and re-read the current market so a trade/decision that resolved
  // against stale prices is never applied on top of fresher ones.
  const decision: RivalDecision = ANTHROPIC_API_KEY
    ? await makeLLMDecision(input, {
        url: ANTHROPIC_URL,
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      })
    : makeRandomDecision(input);

  await withWorldLock(async () => {
    // Liquidated while the LLM was thinking: the decision is void (D-019).
    if (w.rivalLiquidated) return;
    let market = w.market;
    // The rival moves prices like any trader: applyTrade first.
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

/** Start the world clock. Returns a stop function (tests / graceful shutdown). */
export function startWorldLoop(): () => void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        const w = await ensureLiveWorld();
        await withWorldLock(() => tickWorld(w));
      } catch (err) {
        console.error('[world] tick failed', err);
      }
    })();
  }, TICK_INTERVAL_MS);
  console.log(`[world] clock started - ticking every ${TICK_INTERVAL_MS}ms`);
  return () => clearInterval(timer);
}
