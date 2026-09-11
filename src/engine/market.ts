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

import type { Company, MarketEvent, MarketState, Ticker } from './types';

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
}
const COMPANY_SEEDS: SeedSpec[] = [
  { ticker: 'NOVA', name: 'NOVA AI', sector: 'tech', price: 142.31, volatility: 0.035, beta: 1.3, rateSensitivity: 0.8 },
  { ticker: 'TITAN', name: 'TITAN MOTORS', sector: 'auto', price: 87.12, volatility: 0.02, beta: 1.0, rateSensitivity: 0.7 },
  { ticker: 'ORBL', name: 'ORBITAL DYNAMICS', sector: 'space', price: 203.44, volatility: 0.04, beta: 1.4, rateSensitivity: 0.6 },
  { ticker: 'HELX', name: 'HELIX SYSTEMS', sector: 'biotech', price: 61.28, volatility: 0.06, beta: 1.6, rateSensitivity: 0.5 },
  { ticker: 'APXB', name: 'APEX BANK', sector: 'finance', price: 34.9, volatility: 0.008, beta: 0.7, rateSensitivity: 1.6 },
  { ticker: 'PULSE', name: 'PULSE', sector: 'consumer', price: 118.27, volatility: 0.006, beta: 0.5, rateSensitivity: 0.4 },
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
    };
  }
  return { companies, tickCount: 0, timestamp: 0 };
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

