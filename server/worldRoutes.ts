import { Router } from 'express';
import { prisma } from './db';
import { wrap } from './auth';
import { agentObservation, ensureLiveWorld } from './world';
import { buildWorldStatePayload, type FundInput } from './worldCore';
import { buildActivity, buildFundTrace, type CallRowInput, type DecisionRowInput } from './observerCore';
import { OBSERVER_ACTIVITY_LIMIT, OBSERVER_TRACE_LIMIT } from '../config/game';

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
        ...agentObservation(w.agents, f.id),
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

type CallRow = Omit<CallRowInput, 'fundName' | 'toolCalls'> & { toolCalls: CallRowInput['toolCalls'] };

function callInput(c: CallRow, fundName: string): CallRowInput {
  return {
    id: c.id,
    timestamp: c.timestamp,
    fundName,
    outcome: c.outcome,
    rounds: c.rounds,
    servedBy: c.servedBy,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    costUsd: c.costUsd,
    latencyMs: c.latencyMs,
    error: c.error,
    toolCalls: c.toolCalls,
  };
}

const toolsInOrder = { toolCalls: { orderBy: { id: 'asc' as const } } };

/**
 * Investigate one fund (VISION §13): its recent decisions, each with the model
 * call and tool calls behind it, and its memory. 404 for anything that is not
 * a fund of the live world.
 */
worldRouter.get(
  '/funds/:id/trace',
  wrap(async (req, res) => {
    const w = await ensureLiveWorld();
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
    const fund = Number.isSafeInteger(id) ? await prisma.fund.findFirst({ where: { id, worldId: w.worldId } }) : null;
    if (!fund) {
      res.status(404).json({ error: 'fund not found' });
      return;
    }
    const rows = await prisma.rivalDecisionLog.findMany({
      where: { fundId: fund.id },
      orderBy: { id: 'desc' },
      take: OBSERVER_TRACE_LIMIT,
      include: { llmCall: { include: toolsInOrder } },
    });
    const decisions: DecisionRowInput[] = rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      fundName: fund.name,
      tickCountAt: r.tickCountAt,
      action: r.action,
      ticker: r.ticker,
      reasoning: r.reasoning,
      confidence: r.confidence,
      source: r.source,
      model: r.model,
      fillPrice: r.fillPrice,
      realizedPnL: r.realizedPnL,
      llmCall: r.llmCall ? callInput(r.llmCall, fund.name) : null,
    }));
    res.json(buildFundTrace(fund.id, decisions, agentObservation(w.agents, fund.id).memory));
  }),
);

/** What just happened across the world: decisions, model and tool calls, events, liquidations. */
worldRouter.get(
  '/activity',
  wrap(async (_req, res) => {
    const w = await ensureLiveWorld();
    const take = OBSERVER_ACTIVITY_LIMIT;
    const where = { worldId: w.worldId };
    const [decisions, calls, events, liquidations] = await Promise.all([
      prisma.rivalDecisionLog.findMany({ where, orderBy: { id: 'desc' }, take, include: { fund: { select: { name: true } } } }),
      prisma.llmCallLog.findMany({
        where,
        orderBy: { id: 'desc' },
        take,
        include: { fund: { select: { name: true } }, ...toolsInOrder },
      }),
      prisma.marketEventLog.findMany({ where, orderBy: { id: 'desc' }, take }),
      prisma.liquidationLog.findMany({ where, orderBy: { id: 'desc' }, take, include: { fund: { select: { name: true } } } }),
    ]);
    res.json(
      buildActivity(
        {
          decisions: decisions.map((d) => ({
            id: d.id,
            timestamp: d.timestamp,
            fundName: d.fund.name,
            tickCountAt: d.tickCountAt,
            action: d.action,
            ticker: d.ticker,
            reasoning: d.reasoning,
            confidence: d.confidence,
            source: d.source,
            model: d.model,
            fillPrice: d.fillPrice,
            realizedPnL: d.realizedPnL,
            llmCall: null,
          })),
          calls: calls.map((c) => callInput(c, c.fund.name)),
          events,
          liquidations: liquidations.map((l) => ({ timestamp: l.timestamp, fundName: l.fund.name, cause: l.cause })),
        },
        take,
      ),
    );
  }),
);
