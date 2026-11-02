import { Router, type Request } from 'express';
import {
  availableCash,
  getExposure,
  markToMarket,
} from '@black-sheep/engine/portfolio';
import { getNetFlow } from '@black-sheep/engine/market';
import { RIVAL_NAME } from '@black-sheep/engine/rival';
import { prisma } from './db';
import { requireAuth, wrap, type AuthedRequest } from './auth';
import { ensureWorld } from './world';
import { engineFundFromRows } from './worldCore';
import { STARTING_CAPITAL } from '../config/game';

/**
 * Room lifecycle + the read-only state endpoint. Humans observe; they do not trade.
 *
 * The information firewall from Phases 1-2 survives the move to multiplayer:
 * /state NEVER returns other players' positions or cash. Other funds expose
 * only { name, nav, netExposure } — the same class of aggregate signal the
 * rival's RivalDecisionInput was built around. Your own book is fully yours.
 */

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



