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
  type RivalDecision,
  type RivalDecisionInput,
  type RivalFund,
  type RivalPersonality,
} from '@black-sheep/engine/rival';
import { buildFundSystemPrompt, buildRivalUserMessage, shouldRivalReconsider } from '@black-sheep/engine/rivalLLM';
import { runFundTool } from '@black-sheep/engine/fundTools';
import {
  episodeFromDecision,
  episodeFromLiquidation,
  reflect,
  relationshipNote,
  type MemoryEntry,
  type MemoryKind,
} from '@black-sheep/engine/memory';
import { getFundProfileByName, type FundProfile } from '@black-sheep/engine/funds';
import { decideByPolicy, enforceRiskLimit } from '@black-sheep/engine/policies';
import type { MarketEvent, MarketState, Ticker } from '@black-sheep/engine/types';
import { prisma } from './db';
import { BudgetLedger, estimateCallCostUsd } from './budget';
import { anthropicCreate, runDecisionLoop, type CreateMessage, type LoopResult } from './providers/anthropic';
import {
  addMissingCompanies,
  enginePositionFromRow,
  engineFundFromRows,
  missingRegistryFunds,
  parseWorldSnapshot,
  positionKey,
  realizedOfClosed,
  resolveWorldSeed,
  shouldFundDecide,
  singleFlight,
} from './worldCore';
import {
  DECISION_MAX_TOKENS,
  DECISION_PROMPT_TOKENS_ESTIMATE,
  EVENT_BUFFER,
  GLOBAL_DAILY_BUDGET_USD,
  MAX_CONCURRENT_LLM_CALLS,
  MAX_TOOL_ROUNDS,
  MEMORY_LOAD_LIMIT,
  LIVE_WORLD_NAME,
  SNAPSHOT_EVERY_TICKS,
  STARTING_CAPITAL,
  TICK_INTERVAL_MS,
  WORLD_SEED,
} from '../config/game';
import { MODEL_REGISTRY } from '../config/models';

/**
 * The persistent live world.
 *
 * One in-memory World — the single seeded world named LIVE_WORLD_NAME (D-016).
 * The market and every AI fund live HERE, so the world keeps ticking while
 * nobody is watching. Humans only observe it through GET /world/state. The
 * engine is the shared package — the server only orchestrates:
 * tick → persist periodic snapshot → funds decide → persist deltas.
 *
 * Every fund in config/funds.ts is an Agent with its own cadence slot, its own
 * in-flight flag and its own brain (VISION §6). Funds in the world that the
 * registry no longer lists stay observable but never decide.
 */

// Starting capital, tick interval, snapshot cadence, the event buffer and the
// default seed come from config/game.ts — no engine-logic tuning constants live here.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
/** The provider call, or null when no key is configured (funds run on policy). */
const createMessage: CreateMessage | null = ANTHROPIC_API_KEY ? anthropicCreate(ANTHROPIC_API_KEY) : null;
/** Every provider call reserves budget here first (VISION §12, D-025). */
const ledger = new BudgetLedger(GLOBAL_DAILY_BUDGET_USD, MAX_CONCURRENT_LLM_CALLS);

/** Today's spend vs budget for a registered fund, for the observer payload. */
export function fundSpend(fundId: number, profile: FundProfile): { todayUsd: number; dailyBudgetUsd: number } {
  return { todayUsd: ledger.spentToday(fundId, new Date()), dailyBudgetUsd: profile.dailyBudgetUsd };
}

/** One registered fund's live decision state. */
export interface Agent {
  fundId: number;
  profile: FundProfile;
  fund: RivalFund;
  /** One in-flight decision per fund; other funds are unaffected. */
  pending: boolean;
  /** A liquidated fund stays visible but never decides again (D-019). */
  liquidated: boolean;
  /** What the fund's model last saw; the material-change guard compares against it. */
  lastLlmInput: RivalDecisionInput | null;
  /** The fund's newest memories, oldest first, capped at MEMORY_LOAD_LIMIT (D-026). */
  memory: MemoryEntry[];
}

interface World {
  worldId: number;
  name: string;
  /** Persisted at creation; a restart resumes the same RNG stream (D-018). */
  seed: number;
  market: MarketState;
  scheduler: SchedulerState;
  events: MarketEvent[];
  agents: Agent[];
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

/** Rebuild a fund's engine state from persisted rows (DB stores no engine objects). */
async function rebuildFund(fundId: number, market: MarketState, personality: RivalPersonality): Promise<RivalFund> {
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
    personality,
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

  // Every registry fund exists in the world (upsert: safe against a racing boot).
  const existing = await prisma.fund.findMany({ where: { worldId }, select: { name: true } });
  for (const profile of missingRegistryFunds(existing.map((f) => f.name))) {
    await prisma.fund.upsert({
      where: { worldId_name: { worldId, name: profile.name } },
      create: { worldId, name: profile.name, cash: STARTING_CAPITAL, startingCapital: STARTING_CAPITAL },
      update: {},
    });
  }

  // Reconstruct from the latest full snapshot — never replay from t=0.
  const latest = await prisma.marketTick.findFirst({ where: { worldId }, orderBy: { timestamp: 'desc' } });
  let market: MarketState;
  let scheduler: SchedulerState;
  if (latest) {
    ({ market, scheduler } = parseWorldSnapshot(latest.snapshotJson));
    // A snapshot from before the universe grew gains the new listings.
    market = addMissingCompanies(market);
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

  const agents: Agent[] = [];
  const fundRows = await prisma.fund.findMany({ where: { worldId }, orderBy: { id: 'asc' } });
  for (const f of fundRows) {
    const profile = getFundProfileByName(f.name);
    if (!profile) continue; // outside the registry: observed, never decides
    agents.push({
      fundId: f.id,
      profile,
      fund: await rebuildFund(f.id, market, profile.personality),
      pending: false,
      liquidated: f.liquidated,
      lastLlmInput: null,
      memory: await loadMemory(f.id),
    });
  }

  // Seed the budget ledger with what each fund already spent today, so a
  // restart cannot reset a fund's budget.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const spent = await prisma.llmCallLog.groupBy({
    by: ['fundId'],
    where: { worldId, timestamp: { gte: startOfDay } },
    _sum: { costUsd: true },
  });
  ledger.seed(Object.fromEntries(spent.map((r) => [r.fundId, r._sum.costUsd ?? 0])), new Date());

  live = { worldId, name: row.name, seed: row.seed, market, scheduler, events, agents };
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

  // Decision cycle: each fund on its own cadence slot, non-blocking, one call
  // in flight per fund, never for a liquidated fund.
  for (const agent of w.agents) {
    const { decisionEveryTicks, decisionOffset } = agent.profile;
    if (!shouldFundDecide(next.tickCount, agent.pending, agent.liquidated, decisionEveryTicks, decisionOffset)) continue;
    agent.pending = true;
    void decideFund(w, agent)
      .catch((err) => console.error(`[world] ${agent.profile.name} decision failed`, err))
      .finally(() => {
        agent.pending = false;
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

    const agent = w.agents.find((a) => a.fundId === fund.id);
    if (agent) {
      agent.fund = { ...agent.fund, cash: closed.cash, positions: closed.positions };
      agent.liquidated = true;
      await remember(w, agent, [episodeFromLiquidation(cause, w.market.tickCount)]);
    }

    console.log(`[world] ${w.name} fund ${fund.id} LIQUIDATED — ${cause}`);
  }
}

/** Persist a fund's state delta after a decision (fund cash + positions + log). */
async function persistFundState(
  w: World,
  fundId: number,
  before: RivalFund,
  after: RivalFund,
  decision: RivalDecision,
  origin: DecisionOrigin,
): Promise<void> {
  const beforeKeys = new Set(before.positions.map((p) => positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const afterKeys = new Set(after.positions.map((p) => positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const added = after.positions.filter((p) => !beforeKeys.has(positionKey(p.ticker, p.direction, p.entryTimestamp)));
  const removed = before.positions.filter((p) => !afterKeys.has(positionKey(p.ticker, p.direction, p.entryTimestamp)));

  await prisma.$transaction([
    prisma.fund.update({ where: { id: fundId }, data: { cash: after.cash } }),
    ...added.map((p) =>
      prisma.position.create({
        data: {
          fundId,
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
          fundId,
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
        fundId,
        action: decision.action,
        ticker: decision.ticker ?? null,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        // Execution telemetry comes from what actually happened (the stamped
        // lastDecision), not the raw choice — a rejected trade logs no fill.
        fillPrice: after.lastDecision?.fillPrice ?? null,
        realizedPnL: after.lastDecision?.realizedPnL ?? null,
        tickCountAt: w.market.tickCount,
        source: origin.source,
        model: origin.model,
        llmCallId: origin.llmCallId,
      },
    }),
  ]);
}

/** A fund's newest persisted memories, oldest first. */
async function loadMemory(fundId: number): Promise<MemoryEntry[]> {
  const rows = await prisma.agentMemory.findMany({ where: { fundId }, orderBy: { id: 'desc' }, take: MEMORY_LOAD_LIMIT });
  return rows.reverse().map((r) => ({
    kind: r.kind as MemoryKind,
    tickCountAt: r.tickCountAt,
    subject: r.subject,
    content: r.content,
    importance: r.importance,
    outcomeUsd: r.outcomeUsd,
  }));
}

/**
 * Append memories to a fund (in process and in Postgres). Never throws: a
 * failed memory write must not undo or block the decision that caused it.
 */
async function remember(w: World, agent: Agent, entries: MemoryEntry[]): Promise<void> {
  if (entries.length === 0) return;
  agent.memory = [...agent.memory, ...entries].slice(-MEMORY_LOAD_LIMIT);
  try {
    await prisma.agentMemory.createMany({
      data: entries.map((e) => ({ worldId: w.worldId, fundId: agent.fundId, ...e })),
    });
  } catch (err) {
    console.error(`[world] ${agent.profile.name} memory write failed`, err);
  }
}

/**
 * EXPERIENCE → REMEMBER → REFLECT (VISION §6): the deciding fund records its
 * filled trade (and reflects once enough closes accumulate); every other live
 * fund holding that ticker records the public move as a relationship note.
 */
async function rememberDecision(w: World, agent: Agent, after: RivalFund): Promise<void> {
  const tick = w.market.tickCount;
  const episode = episodeFromDecision(after, markToMarket(after, w.market).nav, tick);
  if (!episode) return;
  const own: MemoryEntry[] = [episode];
  const reflection = episode.outcomeUsd !== null ? reflect([...agent.memory, episode], tick) : null;
  if (reflection) own.push(reflection);
  await remember(w, agent, own);

  if (!after.lastDecision) return;
  for (const other of w.agents) {
    if (other === agent || other.liquidated) continue;
    const note = relationshipNote(other.fund.positions, agent.profile.name, after.lastDecision, tick);
    if (note) await remember(w, other, [note]);
  }
}

/** Where a decision came from, recorded on its RivalDecisionLog row (D-025). */
interface DecisionOrigin {
  source: 'llm' | 'policy' | 'budget' | 'busy';
  model: string | null;
  llmCallId: number | null;
}

/** Persist one provider call and its tool invocations. Never throws (logging must not kill a decision). */
async function logLlmCall(w: World, agent: Agent, loop: LoopResult): Promise<number | null> {
  try {
    const row = await prisma.llmCallLog.create({
      data: {
        worldId: w.worldId,
        fundId: agent.fundId,
        provider: 'anthropic',
        model: agent.profile.model,
        servedBy: loop.servedBy,
        purpose: 'decision',
        outcome: loop.outcome,
        rounds: loop.rounds,
        inputTokens: loop.usage.input_tokens,
        outputTokens: loop.usage.output_tokens,
        cacheReadTokens: loop.usage.cache_read_input_tokens,
        cacheWriteTokens: loop.usage.cache_creation_input_tokens,
        costUsd: loop.costUsd,
        latencyMs: loop.latencyMs,
        error: loop.error ?? null,
        toolCalls: {
          create: loop.toolCalls.map((t) => ({
            name: t.name,
            inputJson: JSON.stringify(t.input ?? null),
            outputJson: JSON.stringify(t.output ?? null),
            ok: t.ok,
            latencyMs: t.latencyMs,
          })),
        },
      },
    });
    return row.id;
  } catch (err) {
    console.error(`[world] ${agent.profile.name} call log failed`, err);
    return null;
  }
}

/**
 * Choose who decides this cycle (VISION §12): the fund's deterministic policy
 * when there is no key or nothing material changed since the model last
 * looked; the model when its budget reservation succeeds; the policy again,
 * marked 'budget' when the fund's or the global budget refuses, or 'busy'
 * when the concurrency cap is full. The model runs OUTSIDE the world lock.
 */
async function chooseDecision(
  w: World,
  agent: Agent,
  input: RivalDecisionInput,
): Promise<{ proposed: RivalDecision; origin: DecisionOrigin }> {
  const policy = (source: DecisionOrigin['source'], llmCallId: number | null = null) => ({
    proposed: decideByPolicy(agent.profile, input),
    origin: { source, model: null, llmCallId },
  });

  // Price moves alone don't wake the model; the policy still handles stops and targets.
  if (!createMessage || !shouldRivalReconsider(input, agent.lastLlmInput)) return policy('policy');

  const { model } = agent.profile;
  const estimate = estimateCallCostUsd(model, MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);
  const reservation = ledger.reserve(agent.fundId, agent.profile.dailyBudgetUsd, estimate, new Date());
  if (!reservation) return policy(ledger.atCapacity() ? 'busy' : 'budget');

  let loop: LoopResult;
  try {
    loop = await runDecisionLoop(createMessage, {
      model,
      effort: MODEL_REGISTRY[model].effort,
      system: buildFundSystemPrompt(agent.profile),
      user: buildRivalUserMessage(input),
      maxRounds: MAX_TOOL_ROUNDS,
      maxTokens: DECISION_MAX_TOKENS,
      runTool: (name, args) => runFundTool(name, args, input, agent.profile),
    });
  } catch (err) {
    // A leaked reservation would hold a concurrency slot for the life of the process.
    ledger.release(reservation);
    throw err;
  }
  ledger.settle(reservation, loop.costUsd, new Date());
  agent.lastLlmInput = input;
  const llmCallId = await logLlmCall(w, agent, loop);

  if (!loop.decision) {
    console.warn(`[world] ${agent.profile.name} model gave no decision (${loop.outcome}); using policy`);
    return policy('policy', llmCallId);
  }
  return { proposed: loop.decision, origin: { source: 'llm', model: loop.servedBy, llmCallId } };
}

/** One fund's decision pipeline: decide (outside the lock), then apply + persist (inside). */
async function decideFund(w: World, agent: Agent): Promise<void> {
  const before = agent.fund;
  const input: RivalDecisionInput = { ...buildDecisionInput(before, w.market, w.events, w.market.recentFlow), memory: agent.memory };
  // The decision (and any model call) happens OUTSIDE the world lock. The
  // mutation and persistence below re-acquire the lock and re-read the
  // current market so a decision that resolved against stale prices is never
  // applied on top of fresher ones.
  const { proposed, origin } = await chooseDecision(w, agent, input);
  // The model proposes; the fund's risk limit disposes.
  const decision = enforceRiskLimit(proposed, input, agent.profile);

  await withWorldLock(async () => {
    // Liquidated while the LLM was thinking: the decision is void (D-019).
    if (agent.liquidated) return;
    let market = w.market;
    // A fund moves prices like any trader: applyTrade first.
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
    agent.fund = after;
    await persistFundState(w, agent.fundId, before, after, decision, origin);
    await rememberDecision(w, agent, after);
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
