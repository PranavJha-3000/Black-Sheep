import { Router, type Request } from 'express';
import {
  availableCash,
  closePosition as engClose,
  getExposure,
  INITIAL_MARGIN_RATE,
  markToMarket,
  openPosition as engOpen,
  positionPnl,
} from '@black-sheep/engine/portfolio';
import { applyTrade, getNetFlow } from '@black-sheep/engine/market';
import { RIVAL_NAME } from '@black-sheep/engine/rival';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { Direction, Position, Ticker } from '@black-sheep/engine/types';
import { prisma } from './db';
import { requireAuth, wrap, type AuthedRequest } from './auth';
import { ensureWorld, getWorld, withWorldLock } from './world';

/**
 * Room lifecycle + the read-only state endpoint + the player trade endpoint.
 *
 * The information firewall from Phases 1-2 survives the move to multiplayer:
 * /state NEVER returns other players' positions or cash. Other funds expose
 * only { name, nav, netExposure } — the same class of aggregate signal the
 * rival's RivalDecisionInput was built around. Your own book is fully yours.
 * /trade is the only write path, and it fills through the SAME engine
 * openPosition/closePosition the browser simulation used in Phases 1-2.
 */

const STARTING_CAPITAL = 10_000_000;
// Unambiguous alphabet: no 0/O, 1/I/L — safe to read aloud / type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function authed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}

/** Deterministic, readable fund name from the account email. */
function playerName(email: string): string {
  const local = email.split('@')[0] ?? 'trader';
  return `${local.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'TRADER'} CAPITAL`;
}

function directionOf(value: string): Direction {
  return value === 'short' ? 'short' : 'long';
}

/** Rebuild any persisted fund into the engine's Fund shape (for NAV math). */
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
): Fund {
  return {
    cash,
    positions: rows.map((p) => ({
      id: `db-${p.id}`,
      ticker: p.ticker as Ticker,
      direction: directionOf(p.direction),
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      entryTimestamp: p.entryTimestamp.getTime(),
      marginReserved: directionOf(p.direction) === 'short' ? INITIAL_MARGIN_RATE * p.quantity * p.entryPrice : 0,
    })),
    realizedPnL: 0,
    startingCapital,
    history: [],
  };
}

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /rooms — create a room (returns a short shareable join code)
// ---------------------------------------------------------------------------
roomsRouter.post('/', wrap(async (req, res) => {
  const body = (req.body ?? {}) as { maxPlayers?: unknown };
  const maxPlayers =
    typeof body.maxPlayers === 'number' ? Math.max(2, Math.min(8, Math.floor(body.maxPlayers))) : 4;

  // Collision retry: codes are tiny and rooms are few — 5 tries is plenty.
  let room: { id: number; code: string; maxPlayers: number; status: string } | null = null;
  for (let attempt = 0; attempt < 5 && !room; attempt++) {
    try {
      const created = await prisma.room.create({ data: { code: randomCode(), maxPlayers } });
      room = { id: created.id, code: created.code, maxPlayers: created.maxPlayers, status: created.status };
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }
  if (!room) {
    res.status(500).json({ error: 'Could not allocate a room code, try again.' });
    return;
  }

  // The rival fund is born with the room so the world ticks from the start.
  await prisma.fund.create({
    data: { roomId: room.id, userId: null, name: RIVAL_NAME, cash: STARTING_CAPITAL, startingCapital: STARTING_CAPITAL },
  });
  await ensureWorld(room.id); // warm the world immediately

  res.status(201).json({ room });
}));

// ---------------------------------------------------------------------------
// POST /rooms/:code/join — creates the user's fund in that room, seeded $10M
// ---------------------------------------------------------------------------
roomsRouter.post('/:code/join', wrap(async (req, res) => {
  const { userId } = authed(req);
  const room = await prisma.room.findUnique({ where: { code: req.params.code.toUpperCase() } });
  if (!room || room.status !== 'active') {
    res.status(404).json({ error: 'Room not found or already ended.' });
    return;
  }

  const existing = await prisma.fund.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });
  if (existing) {
    res.json({ room: { code: room.code }, fund: { id: existing.id, name: existing.name }, alreadyJoined: true });
    return;
  }

  const playerCount = await prisma.fund.count({ where: { roomId: room.id, userId: { not: null } } });
  if (playerCount >= room.maxPlayers) {
    res.status(409).json({ error: 'Room is full.' });
    return;
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const fund = await prisma.fund.create({
    data: {
      roomId: room.id,
      userId,
      name: playerName(user.email),
      cash: STARTING_CAPITAL,
      startingCapital: STARTING_CAPITAL,
    },
  });
  await ensureWorld(room.id);

  res.status(201).json({ room: { code: room.code }, fund: { id: fund.id, name: fund.name } });
}));

// ---------------------------------------------------------------------------
// POST /rooms/:code/trade — the ONLY write path for a player's orders.
// Server is source of truth: fills through the same engine openPosition/
// closePosition the browser used in Phases 1-2, applies market impact before
// the fill, and persists cash + position atomically under the per-room lock.
// The client optimistically applies the same math locally, then reconciles
// on the next poll.
// ---------------------------------------------------------------------------
roomsRouter.post('/:code/trade', wrap(async (req, res) => {
  const { userId } = authed(req);
  const room = await prisma.room.findUnique({ where: { code: req.params.code.toUpperCase() } });
  if (!room || room.status !== 'active') {
    res.status(404).json({ error: 'Room not found or already ended.' });
    return;
  }
  const myFund = await prisma.fund.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });
  if (!myFund) {
    res.status(403).json({ error: 'You have not joined this room.' });
    return;
  }

  const body = (req.body ?? {}) as {
    action?: unknown;
    ticker?: unknown;
    dollarAmount?: unknown;
    leverage?: unknown;
    positionId?: unknown;
  };
  const action = body.action;
  if (action !== 'buy' && action !== 'short' && action !== 'close') {
    res.status(400).json({ error: 'action must be buy, short, or close.' });
    return;
  }

  // Serialize with ticks/rival mutations so no price impact gets clobbered.
  const outcome = await withWorldLock(room.id, async () => {
    const w = await ensureWorld(room.id);

    if (action === 'close') {
      const positionId = typeof body.positionId === 'string' ? body.positionId : '';
      const numericId = Number.parseInt(positionId.replace(/^db-/, ''), 10);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        return { status: 400, body: { error: 'Invalid positionId.' } };
      }
      const row = await prisma.position.findFirst({
        where: { id: numericId, fundId: myFund.id, closedAt: null },
      });
      if (!row) {
        return { status: 400, body: { error: 'Position not found or already closed.' } };
      }
      const direction: Direction = row.direction === 'short' ? 'short' : 'long';
      const currentPrice = w.market.companies[row.ticker]?.price ?? row.entryPrice;
      const enginePos: Position = {
        id: `db-${row.id}`,
        ticker: row.ticker as Ticker,
        direction,
        quantity: row.quantity,
        entryPrice: row.entryPrice,
        entryTimestamp: row.entryTimestamp.getTime(),
        marginReserved: direction === 'short' ? INITIAL_MARGIN_RATE * row.quantity * row.entryPrice : 0,
      };
      const engineFund: Fund = {
        cash: myFund.cash,
        positions: [enginePos],
        realizedPnL: 0,
        startingCapital: myFund.startingCapital,
        history: [],
      };
      const after = engClose(engineFund, enginePos.id, currentPrice);
      if (after === engineFund) {
        return { status: 400, body: { error: 'Could not close position.' } };
      }
      const realized = positionPnl(enginePos, currentPrice);
      await prisma.$transaction([
        prisma.fund.update({ where: { id: myFund.id }, data: { cash: after.cash } }),
        prisma.position.update({
          where: { id: numericId },
          data: { closedAt: new Date(), exitPrice: currentPrice },
        }),
      ]);
      return { status: 200, body: { ok: true, realizedPnL: realized, ticker: row.ticker } };
    }

    // buy / short
    const ticker = typeof body.ticker === 'string' ? body.ticker.toUpperCase() : '';
    if (!ticker || !w.market.companies[ticker]) {
      return { status: 400, body: { error: 'Unknown ticker.' } };
    }
    const dollars = typeof body.dollarAmount === 'number' ? body.dollarAmount : Number.NaN;
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return { status: 400, body: { error: 'dollarAmount must be a positive number.' } };
    }
    const lv = Math.max(1, Math.floor(typeof body.leverage === 'number' ? body.leverage : 1));
    const notional = Math.floor(dollars) * lv;
    if (notional <= 0) {
      return { status: 400, body: { error: 'Order too small.' } };
    }
    const direction: Direction = action === 'buy' ? 'long' : 'short';

    // Market impact BEFORE the fill, so the fill price includes our own move.
    const impacted = applyTrade(w.market, ticker, notional, action === 'buy' ? 'buy' : 'sell');
    const fillPrice = impacted.companies[ticker].price;

    const open = await prisma.position.findMany({ where: { fundId: myFund.id, closedAt: null } });
    const engineFund = engineFundFromRows(myFund.cash, myFund.startingCapital, open);
    const after = engOpen(engineFund, ticker, direction, notional, fillPrice);
    if (after === engineFund) {
      return { status: 400, body: { error: 'Insufficient cash or margin for this order.' } };
    }
    const added = after.positions[after.positions.length - 1];
    const createdPos = await prisma
      .$transaction([
        prisma.fund.update({ where: { id: myFund.id }, data: { cash: after.cash } }),
        prisma.position.create({
          data: {
            fundId: myFund.id,
            ticker,
            direction,
            quantity: added.quantity,
            entryPrice: fillPrice,
            entryTimestamp: new Date(added.entryTimestamp),
          },
        }),
      ])
      .then(([, pos]) => pos);

    // Publish the impacted market so every observer sees this move next poll.
    w.market = impacted;
    return {
      status: 200,
      body: { ok: true, fillPrice, quantity: added.quantity, positionId: `db-${createdPos.id}` },
    };
  });

  res.status(outcome.status).json(outcome.body);

  // Best-effort peak NAV update after a successful trade. Not critical to be
  // perfectly synchronized — the tick loop catches any missed updates.
  if (outcome.status === 200) {
    void updatePeakNav(myFund.id);
  }
}));

/**
 * Update a single fund's all-time high NAV from current market prices.
 * Called after trades so the result-card peak stat stays current between ticks.
 */
async function updatePeakNav(fundId: number): Promise<void> {
  const fund = await prisma.fund.findUnique({ where: { id: fundId } });
  if (!fund) return;
  const open = await prisma.position.findMany({ where: { fundId, closedAt: null } });
  const ef = engineFundFromRows(fund.cash, fund.startingCapital, open);
  // We need the market — fetch it from the world if available.
  const w = getWorld(fund.roomId);
  if (!w) return;
  const nav = markToMarket(ef, w.market).nav;
  if (nav > fund.peakNav) {
    await prisma.fund.update({ where: { id: fundId }, data: { peakNav: nav } });
  }
}
// ---------------------------------------------------------------------------
// GET /rooms/:code/state — market + all funds' NAV + your own positions.
// Other players' positions/cash are NEVER included (aggregate signals only).
// ---------------------------------------------------------------------------
roomsRouter.get('/:code/state', wrap(async (req, res) => {
  const { userId } = authed(req);
  const room = await prisma.room.findUnique({ where: { code: req.params.code.toUpperCase() } });
  if (!room) {
    res.status(404).json({ error: 'Room not found.' });
    return;
  }

  const myFund = await prisma.fund.findUnique({
    where: { roomId_userId: { roomId: room.id, userId } },
  });
  if (!myFund) {
    res.status(403).json({ error: 'You have not joined this room.' });
    return;
  }

  const w = await ensureWorld(room.id);

  // Stamp lastSeenAt so a later rejoin can compute "what happened while you
  // were away". Fire-and-forget: this is a pure bookkeeping write and must
  // never delay (or break) the state response the poll is waiting on.
  void prisma.fund
    .update({ where: { id: myFund.id }, data: { lastSeenAt: new Date() } })
    .catch(() => undefined);

  // Every fund's NAV + AGGREGATE exposure only — this is the multiplayer
  // version of the information firewall: NAV is public (it's the scoreboard),
  // books are not.
  const allFunds = await prisma.fund.findMany({ where: { roomId: room.id } });
  const funds: Array<{ id: number; name: string; userId: number | null; nav: number; netExposure: number }> = [];
  for (const f of allFunds) {
    const open = await prisma.position.findMany({ where: { fundId: f.id, closedAt: null } });
    const ef = engineFundFromRows(f.cash, f.startingCapital, open);
    funds.push({
      id: f.id,
      name: f.name,
      userId: f.userId,
      nav: Math.max(1, markToMarket(ef, w.market).nav),
      netExposure: getExposure(ef, w.market).netExposure,
    });
  }

  // My book: full visibility into my own fund only.
  const myOpen = await prisma.position.findMany({ where: { fundId: myFund.id, closedAt: null } });
  const myEngineFund = engineFundFromRows(myFund.cash, myFund.startingCapital, myOpen);
  const myPositions = myEngineFund.positions.map((p) => {
    const price = w.market.companies[p.ticker]?.price ?? p.entryPrice;
    const raw = (price - p.entryPrice) * p.quantity;
    return {
      id: p.id,
      ticker: p.ticker,
      direction: p.direction,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      entryTimestamp: p.entryTimestamp,
      marginReserved: p.marginReserved,
      price,
      pnl: p.direction === 'long' ? raw : -raw,
    };
  });

  // Public crowd signal per ticker — the same signal the rival sees. No book.
  const flow: Record<string, number> = {};
  for (const ticker of Object.keys(w.market.companies)) {
    flow[ticker] = getNetFlow(w.market, ticker, 15);
  }

  const lastRivalDecision = await prisma.rivalDecisionLog.findFirst({
    where: { roomId: room.id },
    orderBy: { timestamp: 'desc' },
  });
  const latestLiquidation = myFund.liquidated
    ? await prisma.liquidationLog.findFirst({
        where: { fundId: myFund.id },
        orderBy: { timestamp: 'desc' },
      })
    : null;
  const recentEvents = await prisma.marketEventLog.findMany({
    where: { roomId: room.id },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  res.json({
    room: {
      code: room.code,
      status: room.status,
      maxPlayers: room.maxPlayers,
      tickCount: w.market.tickCount,
    },
    market: {
      timestamp: w.market.timestamp,
      companies: Object.fromEntries(
        Object.values(w.market.companies).map((c) => [
          c.ticker,
          {
            ticker: c.ticker,
            name: c.name,
            sector: c.sector,
            price: c.price,
            previousClose: c.previousClose,
            volatility: c.volatility,
            beta: c.beta,
            rateSensitivity: c.rateSensitivity,
            liquidity: c.liquidity,
          },
        ]),
      ),
    },
    funds,
    me: {
      fundId: myFund.id,
      name: myFund.name,
      cash: myFund.cash,
      availCash: availableCash(myEngineFund),
      nav: funds.find((f) => f.id === myFund.id)?.nav ?? STARTING_CAPITAL,
      startingCapital: myFund.startingCapital,
      positions: myPositions,
      // Server-authoritative liquidation state. The client renders the
      // LiquidationScreen when liquidated=true; cause/rivalContext come from
      // the latest LiquidationLog (null when the fund is still alive).
      liquidated: myFund.liquidated,
      liquidationCause: latestLiquidation?.cause ?? null,
      liquidationRivalContext: latestLiquidation?.rivalContext ?? null,
    },
    flow,
    rival: {
      name: RIVAL_NAME,
      thinking: w.rivalPending,
      lastDecision: lastRivalDecision
        ? {
            action: lastRivalDecision.action,
            ticker: lastRivalDecision.ticker,
            reasoning: lastRivalDecision.reasoning,
            confidence: lastRivalDecision.confidence ?? 0.7,
            fillPrice: lastRivalDecision.fillPrice ?? null,
            realizedPnL: lastRivalDecision.realizedPnL ?? null,
            tickCountAt: lastRivalDecision.tickCountAt ?? 0,
            at: lastRivalDecision.timestamp,
          }
        : null,
    },
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      type: e.type,
      ticker: e.ticker,
      headline: e.headline,
      priceImpactPercent: e.priceImpactPercent,
      tickCountAt: e.tickCountAt ?? 0,
      at: e.timestamp,
    })),
  });
}));



