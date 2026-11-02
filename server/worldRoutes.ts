import { Router } from 'express';
import { prisma } from './db';
import { wrap } from './auth';
import { ensureLiveWorld } from './world';
import { buildWorldStatePayload, type FundInput } from './worldCore';

/**
 * The public observer API (D-017). Humans watch the live world; they never
 * trade and need no account. Every fund's book is visible here — agent
 * isolation is enforced where agents read, in buildDecisionInput, not here.
 * The payload shape (and what it must never contain) is owned by
 * worldCore.buildWorldStatePayload.
 */
export const worldRouter = Router();

worldRouter.get(
  '/state',
  wrap(async (_req, res) => {
    const w = await ensureLiveWorld();

    const funds = await prisma.fund.findMany({ where: { worldId: w.worldId }, orderBy: { id: 'asc' } });
    const fundInputs: FundInput[] = [];
    for (const f of funds) {
      const openPositions = await prisma.position.findMany({ where: { fundId: f.id, closedAt: null } });
      const lastDecision = await prisma.rivalDecisionLog.findFirst({
        where: { fundId: f.id },
        orderBy: { timestamp: 'desc' },
      });
      const liquidation = f.liquidated
        ? await prisma.liquidationLog.findFirst({ where: { fundId: f.id }, orderBy: { timestamp: 'desc' } })
        : null;
      fundInputs.push({
        id: f.id,
        name: f.name,
        cash: f.cash,
        startingCapital: f.startingCapital,
        peakNav: f.peakNav,
        liquidated: f.liquidated,
        liquidationCause: liquidation?.cause ?? null,
        thinking: w.rivalPending && f.id === w.rivalFundId,
        openPositions,
        lastDecision,
      });
    }

    const events = await prisma.marketEventLog.findMany({
      where: { worldId: w.worldId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });

    res.json(buildWorldStatePayload({ name: w.name, seed: w.seed }, w.market, fundInputs, events));
  }),
);
