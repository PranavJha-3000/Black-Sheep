/*
 * Black Sheep - market simulation.
 *
 * ENGINE PURITY RULE: zero UI dependencies in this file. Pure TS only so it
 * can be unit-tested with Vitest and later run unmodified on a server.
 *
 * Price model: mean-reverting random walk scaled by per-company volatility.
 *   drift = (previousClose - price) * MEAN_REVERSION
 *   noise = (rng() - 0.5) * 2 * volatility * price
 *   price = max(MIN_PRICE, price + drift + noise)
 * Deterministic given the seed.
 */

import type { Company, FlowRecord, MarketEvent, MarketState, Ticker } from './types';

/** Mean-reversion strength per tick (fraction of the gap closed). */
const MEAN_REVERSION = 0.02;
/** Floor so prices never reach zero or go negative. */
const MIN_PRICE = 0.01;

/**
 * Mulberry32 - small, fast, seedable PRNG. Returns values in [0, 1).
 * No external deps.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedSpec {
  ticker: Ticker;
  name: string;
  sector: Company['sector'];
  price: number;
  volatility: number;
  beta: number;
  rateSensitivity: number;
  liquidity: number;
}
const COMPANY_SEEDS: SeedSpec[] = [
  { ticker: 'NOVA', name: 'NOVA AI', sector: 'tech', price: 142.31, volatility: 0.035, beta: 1.3, rateSensitivity: 0.8, liquidity: 150_000_000 },
  { ticker: 'TITAN', name: 'TITAN MOTORS', sector: 'auto', price: 87.12, volatility: 0.02, beta: 1.0, rateSensitivity: 0.7, liquidity: 200_000_000 },
  { ticker: 'ORBL', name: 'ORBITAL DYNAMICS', sector: 'space', price: 203.44, volatility: 0.04, beta: 1.4, rateSensitivity: 0.6, liquidity: 80_000_000 },
  { ticker: 'HELX', name: 'HELIX SYSTEMS', sector: 'biotech', price: 61.28, volatility: 0.06, beta: 1.6, rateSensitivity: 0.5, liquidity: 40_000_000 },
  { ticker: 'APXB', name: 'APEX BANK', sector: 'finance', price: 34.9, volatility: 0.008, beta: 0.7, rateSensitivity: 1.6, liquidity: 1_200_000_000 },
  { ticker: 'PULSE', name: 'PULSE', sector: 'consumer', price: 118.27, volatility: 0.006, beta: 0.5, rateSensitivity: 0.4, liquidity: 800_000_000 },
];
export function createInitialMarket(): MarketState {
  const companies: Record<Ticker, Company> = {};
  for (const s of COMPANY_SEEDS) {
    companies[s.ticker] = {
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      price: s.price,
      previousClose: s.price,
      volatility: s.volatility,
      beta: s.beta,
      rateSensitivity: s.rateSensitivity,
      liquidity: s.liquidity,
    };
  }
  return { companies, tickCount: 0, timestamp: 0, recentFlow: [] };
}

/** Advance the market one tick. Deterministic given (state, seed). */
export function tickMarket(state: MarketState, rngSeed?: number): MarketState {
  // Mix the tick number into the seed so consecutive ticks see fresh noise,
  // while (seed, tick) remains a fully deterministic (state -> state) map.
  const seedBase = rngSeed ?? 0x9e3779b9;
  const rng = mulberry32((seedBase ^ Math.imul(state.tickCount + 1, 0x85ebca6b)) >>> 0);
  const companies: Record<Ticker, Company> = {};

  for (const ticker of Object.keys(state.companies)) {
    const c = state.companies[ticker];
    const drift = (c.previousClose - c.price) * MEAN_REVERSION;
    const noise = (rng() - 0.5) * 2 * c.volatility * c.price;
    const nextPrice = Math.max(MIN_PRICE, c.price + drift + noise);
    companies[ticker] = { ...c, price: nextPrice };
  }

  return {
    companies,
    tickCount: state.tickCount + 1,
    timestamp: state.timestamp + 1,
    recentFlow: state.recentFlow,
  };
}

/** Apply a one-time price shock on top of normal drift. */
export function applyEvent(state: MarketState, event: MarketEvent): MarketState {
  const impact = event.priceImpactPercent / 100;
  const companies: Record<Ticker, Company> = {};

  for (const ticker of Object.keys(state.companies)) {
    const c = state.companies[ticker];
    // Macro rate shocks scale with rateSensitivity; single-company hits full impact.
    const scale = event.type === 'macro' ? c.rateSensitivity : 1;
    const nextPrice = isAffected(c, event)
      ? Math.max(MIN_PRICE, c.price * (1 + impact * scale))
      : c.price;
    companies[ticker] = { ...c, price: nextPrice };
  }

  return { ...state, companies };
}

function isAffected(c: Company, event: MarketEvent): boolean {
  switch (event.type) {
    case 'company':
    case 'earnings':
      return event.ticker === c.ticker;
    case 'sector':
      return event.sector === c.sector;
    case 'macro':
      return true;
  }
}

// ---------------------------------------------------------------------------
// Market-impact engine — order-flow price formation
// ---------------------------------------------------------------------------

/**
 * Calibration constant for the square-root impact model. Higher = trades move
 * price more for a given participation rate. Tuned so a $5M trade on thin
 * HELX (~$40M ADV) moves ~3.5%, same $5M on deep APXB (~$1.2B ADV) moves
 * ~0.65% — a 5.5x liquidity spread that is visible on the chart.
 */
const IMPACT_COEFF = 0.1;

/**
 * Hard cap on single-trade impact. Without this, a sufficiently large trade
 * could liquidate the entire market in one execution — unrealistic and
 * unfungeable. Acts as an analog to exchange-level circuit breakers
 * (e.g. CME/LME price limits, NYSE Rule 80A collars) that halt or throttle
 * moves beyond a threshold. Set at 8%: enough that small trades feel
 * inconsequential and even aggressive sizing can't single-tick crash a name.
 */
const MAX_IMPACT = 0.08;

/** Max entries retained in MarketState.recentFlow. */
const FLOW_CAP = 50;

/**
 * Compute the percentage price impact of a trade using the square-root model.
 *
 * Why square-root and not linear: a linear model (impact = k * size) makes it
 * infinitely cheap to counter-trade against a whale — a $500M sell drops
 * price 10%, then a $500M buy buys it back 10% with zero net cost, so whales
 * are free to front-run. Real market microstructure research (Almgren-Chriss,
 * Bouchaud et al., empirical TAQ/LOB studies) consistently finds impact
 * scales as sqrt(participation rate): each additional dollar moves the price
 * less than the previous one, so crowding a trade is costly and large orders
 * must be worked slowly. We follow that convention.
 *
 * @param company         The company being traded (provides liquidity).
 * @param tradeDollarAmount  Notional size of the trade in dollars (always > 0).
 * @param direction       'buy' pushes price up, 'sell'/'short' pushes down.
 * @returns Signed fractional impact (e.g. +0.03 = 3% up, -0.03 = 3% down).
 */
export function computePriceImpact(
  company: Company,
  tradeDollarAmount: number,
  direction: 'buy' | 'sell',
): number {
  if (tradeDollarAmount <= 0 || company.liquidity <= 0) return 0;

  // Participation rate = fraction of daily volume this trade represents.
  const participationRate = tradeDollarAmount / company.liquidity;

  // Square-root impact model. Capped so one trade cannot break the market.
  const rawImpact = IMPACT_COEFF * Math.sqrt(participationRate);
  const capped = Math.min(rawImpact, MAX_IMPACT);

  return direction === 'buy' ? capped : -capped;
}

/**
 * Execute a trade against the market: apply price impact immediately on
 * execution (so trades feel consequential instead of filling at the stale
 * mid-price) and record the trade into recentFlow for the rival AI to read.
 *
 * Pure function — returns a new MarketState, never mutates the input.
 *
 * @param state     Current market state.
 * @param ticker    Company being traded.
 * @param dollarAmount  Notional size in dollars.
 * @param direction 'buy' or 'sell'.
 */
export function applyTrade(
  state: MarketState,
  ticker: string,
  dollarAmount: number,
  direction: 'buy' | 'sell',
): MarketState {
  const company = state.companies[ticker];
  if (!company || dollarAmount <= 0) return state;

  const impactPct = computePriceImpact(company, dollarAmount, direction);
  const nextPrice = Math.max(MIN_PRICE, company.price * (1 + impactPct));

  const record: FlowRecord = {
    ticker,
    direction,
    dollarAmount,
    timestamp: state.timestamp,
  };

  // Append and cap to FLOW_CAP most recent entries.
  const nextFlow = [...state.recentFlow, record];
  const trimmedFlow = nextFlow.length > FLOW_CAP ? nextFlow.slice(nextFlow.length - FLOW_CAP) : nextFlow;

  return {
    ...state,
    companies: {
      ...state.companies,
      [ticker]: { ...company, price: nextPrice },
    },
    recentFlow: trimmedFlow,
  };
}

/**
 * Sum recentFlow for a ticker into a single signed number over a lookback
 * window. Positive = net buying pressure, negative = net selling. This is the
 * function that lets the rival AI "notice you're crowding a trade" — sustained
 * one-sided flow signals a position is being built.
 *
 * @param state         Current market state.
 * @param ticker        Company to query.
 * @param lookbackTicks How many ticks back to include. Trades older than
 *                      (state.timestamp - lookbackTicks) are excluded.
 * @returns Signed net flow in dollars (buys positive, sells negative).
 */
export function getNetFlow(
  state: MarketState,
  ticker: string,
  lookbackTicks: number,
): number {
  if (lookbackTicks <= 0) return 0;
  const cutoff = state.timestamp - lookbackTicks;

  let net = 0;
  for (const r of state.recentFlow) {
    if (r.ticker !== ticker) continue;
    if (r.timestamp < cutoff) continue;
    net += r.direction === 'buy' ? r.dollarAmount : -r.dollarAmount;
  }
  return net;
}

