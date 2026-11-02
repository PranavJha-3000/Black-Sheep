import { createInitialMarket, getNetFlow } from '@black-sheep/engine/market';
import { FUND_PROFILES, getFundProfileByName, type FundProfile } from '@black-sheep/engine/funds';
import { getExposure, INITIAL_MARGIN_RATE, markToMarket } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import { RIVAL_DECISION_TICKS } from '@black-sheep/engine/rival';
import type { SchedulerState } from '@black-sheep/engine/events';
import type { Company, Direction, MarketState, Position, Ticker } from '@black-sheep/engine/types';

/**
 * worldCore — the pure half of the live world.
 *
 * No prisma, no express, no process.env: everything here is a function of its
 * arguments so the rules that matter for persistence and observation (seed
 * resolution, snapshot integrity, decision cadence, the public payload) are
 * unit-testable without a database. server/world.ts does the I/O around it.
 */

// ---------------------------------------------------------------------------
// DB row → engine shapes
// ---------------------------------------------------------------------------

export interface PositionRow {
  id: number;
  ticker: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  entryTimestamp: Date;
}

export interface ClosedPositionRow {
  direction: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
}

export function enginePositionFromRow(row: PositionRow): Position {
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

/** Build an engine Fund from DB position rows (realized PnL is not needed for NAV). */
export function engineFundFromRows(cash: number, startingCapital: number, rows: PositionRow[]): Fund {
  return {
    cash,
    positions: rows.map(enginePositionFromRow),
    realizedPnL: 0,
    startingCapital,
    history: [],
  };
}

export function realizedOfClosed(row: ClosedPositionRow): number {
  if (row.exitPrice === null) return 0;
  const raw = (row.exitPrice - row.entryPrice) * row.quantity;
  return row.direction === 'long' ? raw : -raw;
}

export function positionKey(ticker: string, direction: string, entryTimestamp: number): string {
  return `${ticker}:${direction}:${entryTimestamp}`;
}

// ---------------------------------------------------------------------------
// Seed, snapshot, cadence
// ---------------------------------------------------------------------------

/** Largest seed that fits Postgres int4 (World.seed). */
export const MAX_WORLD_SEED = 2_147_483_647;

/**
 * The seed is chosen once and persisted (D-018). A persisted seed always wins,
 * so a restart resumes the same world; an env value that disagrees is reported
 * (envIgnored) rather than silently reseeding. Invalid env values fall back.
 */
export function resolveWorldSeed(
  persisted: number | null,
  envValue: string | undefined,
  fallback: number,
): { seed: number; envIgnored: boolean } {
  if (persisted !== null) {
    return { seed: persisted, envIgnored: envValue !== undefined && envValue !== String(persisted) };
  }
  if (envValue !== undefined && /^\d+$/.test(envValue)) {
    const n = Number(envValue);
    if (n <= MAX_WORLD_SEED) return { seed: n, envIgnored: false };
  }
  return { seed: fallback, envIgnored: false };
}

/** Parse a persisted MarketTick snapshot. Corruption throws — never a silent fresh market. */
export function parseWorldSnapshot(json: string): { market: MarketState; scheduler: SchedulerState } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('corrupt world snapshot');
  }
  if (!isValidSnapshot(parsed)) throw new Error('corrupt world snapshot');
  return parsed;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Deep enough to catch what would freeze the clock silently: a NaN tickCount
 * never hits the snapshot/decision cadence, and a NaN price poisons every NAV.
 */
function isValidSnapshot(v: unknown): v is { market: MarketState; scheduler: SchedulerState } {
  if (!v || typeof v !== 'object') return false;
  const { market, scheduler } = v as { market?: Record<string, unknown>; scheduler?: Record<string, unknown> };
  if (!market || typeof market !== 'object' || !scheduler || typeof scheduler !== 'object') return false;
  if (!isFiniteNumber(market.tickCount) || !isFiniteNumber(market.timestamp)) return false;
  if (!Array.isArray(market.recentFlow)) return false;
  if (!isFiniteNumber(scheduler.nextFireTick)) return false;
  const companies = market.companies;
  if (!companies || typeof companies !== 'object') return false;
  const list = Object.values(companies as Record<string, { price?: unknown }>);
  return list.length > 0 && list.every((c) => c && isFiniteNumber(c.price));
}

/**
 * Collapse concurrent calls into one in-flight load. A rejected load is
 * forgotten so the next call retries; a resolved one is shared by all callers.
 * Used by ensureLiveWorld so a poll and a tick racing on boot cannot each
 * build their own World.
 */
export function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;
  return () => {
    if (!inFlight) {
      inFlight = load().catch((err: unknown) => {
        inFlight = undefined;
        throw err;
      });
    }
    return inFlight;
  };
}

/**
 * A fund decides on its own cadence slot (tickCount % every === offset), one
 * call in flight, and never once liquidated. Each fund passes its own
 * pending/liquidated flags, so one fund's slow call never blocks another.
 */
export function shouldFundDecide(
  tickCount: number,
  pending: boolean,
  liquidated: boolean,
  every: number = RIVAL_DECISION_TICKS,
  offset = 0,
): boolean {
  return tickCount > 0 && tickCount % every === offset && !pending && !liquidated;
}

/**
 * Registry funds the world does not have yet (matched by name, the fund's
 * in-world identity). Funds in the world that the registry does not list are
 * left alone: they stay observable but never decide.
 */
export function missingRegistryFunds(existingNames: string[]): FundProfile[] {
  const have = new Set(existingNames);
  return FUND_PROFILES.filter((p) => !have.has(p.name));
}

/**
 * Bring a snapshot taken before the company universe grew up to date: any
 * company the engine now lists but the snapshot lacks joins at its seed
 * price. Existing companies are untouched. Returns the same market when
 * nothing is missing.
 */
export function addMissingCompanies(market: MarketState): MarketState {
  const seeds = createInitialMarket().companies;
  const missing = Object.keys(seeds).filter((t) => !(t in market.companies));
  if (missing.length === 0) return market;
  const companies = { ...market.companies };
  for (const t of missing) companies[t] = seeds[t];
  return { ...market, companies };
}

// ---------------------------------------------------------------------------
// Public observer payload (GET /world/state)
// ---------------------------------------------------------------------------

export interface ObservedPosition {
  id: string;
  ticker: Ticker;
  direction: Direction;
  quantity: number;
  entryPrice: number;
  entryTimestamp: number;
  marginReserved: number;
  price: number;
  pnl: number;
}

export interface ObservedDecision {
  action: string;
  ticker: string | null;
  reasoning: string;
  confidence: number | null;
  fillPrice: number | null;
  realizedPnL: number | null;
  tickCountAt: number | null;
  at: string;
}

/** The public face of a registered fund (null for funds outside the registry). */
export interface ObservedProfile {
  key: string;
  personality: string;
  mandate: string;
  strategy: string;
  model: string;
}

export interface ObservedFund {
  id: number;
  name: string;
  profile: ObservedProfile | null;
  cash: number;
  startingCapital: number;
  nav: number;
  peakNav: number;
  grossExposure: number;
  netExposure: number;
  liquidated: boolean;
  liquidationCause: string | null;
  thinking: boolean;
  positions: ObservedPosition[];
  lastDecision: ObservedDecision | null;
}

export interface ObservedEvent {
  id: number;
  type: string;
  ticker: string | null;
  headline: string;
  priceImpactPercent: number;
  tickCountAt: number | null;
  at: string;
}

export interface WorldStatePayload {
  world: { name: string; seed: number; tickCount: number; timestamp: number };
  market: { companies: Record<string, Company> };
  funds: ObservedFund[];
  flow: Record<string, number>;
  recentEvents: ObservedEvent[];
}

export interface FundInput {
  id: number;
  name: string;
  cash: number;
  startingCapital: number;
  peakNav: number;
  liquidated: boolean;
  liquidationCause: string | null;
  thinking: boolean;
  openPositions: PositionRow[];
  lastDecision: {
    action: string;
    ticker: string | null;
    reasoning: string;
    confidence: number | null;
    fillPrice: number | null;
    realizedPnL: number | null;
    tickCountAt: number | null;
    timestamp: Date;
  } | null;
}

export interface EventInput {
  id: number;
  type: string;
  ticker: string | null;
  headline: string;
  priceImpactPercent: number;
  tickCountAt: number | null;
  timestamp: Date;
}

/**
 * The public observer view (D-017). Humans see every fund's book; agents never
 * read this — their isolation lives in buildDecisionInput. Only explicitly
 * listed fields are copied, so the scheduler, RNG and unfired events cannot
 * leak into it.
 */
export function buildWorldStatePayload(
  world: { name: string; seed: number },
  market: MarketState,
  funds: FundInput[],
  events: EventInput[],
): WorldStatePayload {
  const companies: Record<string, Company> = {};
  for (const c of Object.values(market.companies)) {
    companies[c.ticker] = {
      ticker: c.ticker,
      name: c.name,
      sector: c.sector,
      price: c.price,
      previousClose: c.previousClose,
      volatility: c.volatility,
      beta: c.beta,
      rateSensitivity: c.rateSensitivity,
      liquidity: c.liquidity,
    };
  }

  const flow: Record<string, number> = {};
  for (const ticker of Object.keys(market.companies)) {
    flow[ticker] = getNetFlow(market, ticker, 15);
  }

  const observed = [...funds]
    .sort((a, b) => a.id - b.id)
    .map((f): ObservedFund => {
      const ef = engineFundFromRows(f.cash, f.startingCapital, f.openPositions);
      const exposure = getExposure(ef, market);
      const profile = getFundProfileByName(f.name);
      return {
        id: f.id,
        name: f.name,
        profile: profile
          ? {
              key: profile.key,
              personality: profile.personality,
              mandate: profile.mandate,
              strategy: profile.strategy,
              model: profile.model,
            }
          : null,
        cash: f.cash,
        startingCapital: f.startingCapital,
        nav: Math.max(1, markToMarket(ef, market).nav),
        peakNav: f.peakNav,
        grossExposure: exposure.grossExposure,
        netExposure: exposure.netExposure,
        liquidated: f.liquidated,
        liquidationCause: f.liquidationCause,
        thinking: f.thinking,
        positions: ef.positions.map((p) => {
          const price = market.companies[p.ticker]?.price ?? p.entryPrice;
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
        }),
        lastDecision: f.lastDecision
          ? {
              action: f.lastDecision.action,
              ticker: f.lastDecision.ticker,
              reasoning: f.lastDecision.reasoning,
              confidence: f.lastDecision.confidence,
              fillPrice: f.lastDecision.fillPrice,
              realizedPnL: f.lastDecision.realizedPnL,
              tickCountAt: f.lastDecision.tickCountAt,
              at: f.lastDecision.timestamp.toISOString(),
            }
          : null,
      };
    });

  return {
    world: { name: world.name, seed: world.seed, tickCount: market.tickCount, timestamp: market.timestamp },
    market: { companies },
    funds: observed,
    flow,
    recentEvents: events.map((e) => ({
      id: e.id,
      type: e.type,
      ticker: e.ticker,
      headline: e.headline,
      priceImpactPercent: e.priceImpactPercent,
      tickCountAt: e.tickCountAt,
      at: e.timestamp.toISOString(),
    })),
  };
}
