import { Router, type Request } from 'express';
import {
  confrontationsDuringAway,
  isNotable,
  positionDeltas,
  relevantEvents,
} from '@black-sheep/engine/away';
import type { Position, Ticker } from '@black-sheep/engine/types';
import { markToMarket } from '@black-sheep/engine/portfolio';
import { prisma } from './db';
import { requireAuth, wrap, type AuthedRequest } from './auth';
import { ensureWorld } from './world';
import { awayDecisionOf, awayRowsOf, enginePosition, parseSnapshot } from './awayUtil';

function authed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}

/**
 * GET /rooms/:code/away-summary?since=<ms epoch> — async re-engagement.
 *
 * "What happened while I was away": NAV then→now, per-position P&L deltas,
 * only the events that touched held tickers, and rival decisions replayed
 * against the away book through the SAME detectConfrontation the live
 * terminal uses. `since` is a wall-clock ms epoch; the server clamps it to
 * now and reads snapshots/logs/positions around it (read-only).
 *
 * NOTE on "NAV then": the only price history is periodic MarketTick
 * snapshots (Phase 3 design). NAV-then is reconstructed from the nearest
 * snapshot AT or BEFORE `since` (fallback: current prices, which degrades
 * deltas to ~0 rather than inventing history). Rows closed inside the window
 * contribute realized P&L so an exit still shows up.
 */
export const awayRouter = Router();
awayRouter.use(requireAuth);

awayRouter.get('/:code/away-summary', wrap(async (req, res) => {
  const userId = authed(req).userId;
  const code = String(req.params.code ?? '').trim().toUpperCase();
  const sinceMs = Number(req.query.since);
  if (!code) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) {
    res.status(400).json({ error: 'Query param ?since=<ms epoch> is required.' });
    return;
  }

  const room = await prisma.room.findUnique({ where: { code } });
  if (!room || room.status !== 'active') {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  const myFund = await prisma.fund.findFirst({ where: { roomId: room.id, userId } });
  if (!myFund) {
    res.status(403).json({ error: 'You are not a member of this room' });
    return;
  }

  const nowMs = Date.now();
  const since = new Date(Math.min(sinceMs, nowMs));
  const awayMs = Math.max(0, nowMs - since.getTime());

  const w = await ensureWorld(room.id);
  const priceNow = (t: Ticker): number => w.market.companies[t]?.price ?? 0;

  const thenSnap = await prisma.marketTick.findFirst({
    where: { roomId: room.id, timestamp: { lte: since } },
    orderBy: { timestamp: 'desc' },
  });
  let priceThen = priceNow;
  let ticksElapsed = 0;
  if (thenSnap) {
    const { prices, tickCount } = parseSnapshot(thenSnap.snapshotJson);
    priceThen = (t: Ticker) => prices[t] ?? 0;
    ticksElapsed = Math.max(0, w.market.tickCount - tickCount);
  }

  // Every row open at any point in the window: still-open rows plus rows
  // closed after `since` (their realized P&L is the away story).
  const [openRows, closedRows] = await Promise.all([
    prisma.position.findMany({ where: { fundId: myFund.id, closedAt: null } }),
    prisma.position.findMany({ where: { fundId: myFund.id, closedAt: { gt: since } } }),
  ]);
  const awayRows = awayRowsOf([...openRows, ...closedRows]);
  const held = new Set<Ticker>(awayRows.map((r) => r.ticker));

  const navNow = markToMarket(
    {
      cash: myFund.cash,
      positions: openRows.map(enginePosition),
      realizedPnL: 0,
      startingCapital: myFund.startingCapital,
      history: [],
    },
    w.market,
  ).nav;
  let navThen = navNow;
  if (thenSnap) {
    let thenMv = 0;
    for (const r of awayRows) {
      const px = priceThen(r.ticker);
      if (px <= 0) continue;
      const raw = (px - r.entryPrice) * r.quantity;
      thenMv += r.direction === 'long' ? raw : -raw;
    }
    navThen = myFund.cash + thenMv;
  }

  const positions = positionDeltas(awayRows, priceThen, priceNow);

  const eventRows = await prisma.marketEventLog.findMany({
    where: { roomId: room.id, timestamp: { gt: since } },
    orderBy: { timestamp: 'asc' },
    take: 100,
  });
  const relevant = relevantEvents(
    eventRows.map((e) => ({
      ticker: (e.ticker ?? null) as Ticker | null,
      headline: e.headline,
      priceImpactPercent: e.priceImpactPercent,
    })),
    held,
  );

  const decisionRows = await prisma.rivalDecisionLog.findMany({
    where: { roomId: room.id, timestamp: { gt: since } },
    orderBy: { timestamp: 'asc' },
    take: 50,
  });
  const heldPositions: Position[] = awayRows.map((r) => ({
    id: 'away',
    ticker: r.ticker,
    direction: r.direction,
    quantity: r.quantity,
    entryPrice: r.entryPrice,
    entryTimestamp: 0,
    marginReserved: 0,
  }));
  const confrontations = confrontationsDuringAway(
    heldPositions,
    decisionRows.map(awayDecisionOf),
  );

  const summary = {
    awayMs,
    ticksElapsed,
    navThen,
    navNow,
    navDelta: navNow - navThen,
    positions,
    relevantEvents: relevant,
    confrontations,
  };
  res.json({ ...summary, notable: isNotable(summary) });
}));
