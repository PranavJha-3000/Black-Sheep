/*
 * Black Sheep - the World Director (VISION §8). PURE.
 *
 * The Director is a game master, not a fund. It observes PUBLIC conditions
 * only (quotes, how long since the last fired event, how many funds are
 * alive), chooses one intervention from a fixed catalog — or none — and the
 * deterministic event engine builds and applies the consequence. The catalog
 * names sectors and the macro backdrop, never a single stock, so the Director
 * cannot move one company's price or pick a winner. It never sees fund
 * reasoning, positions, the event scheduler or unfired events.
 *
 * Every proposal — from the rule-based Director here or a future Jev adapter —
 * passes validateIntervention before it can touch the world.
 */

import {
  DIRECTOR_CALM_ABS_CHANGE,
  DIRECTOR_COOLDOWN_TICKS,
  DIRECTOR_EVERY_TICKS,
  DIRECTOR_HOT_ABS_CHANGE,
  DIRECTOR_QUIET_TICKS,
  DIRECTOR_RUNUP_CHANGE,
} from '../../../config/game';
import type { MarketEvent, MarketState, Sector } from './types';

export const DIRECTOR_INTERVENTIONS = ['none', 'macro_tightening', 'macro_easing', 'sector_shock', 'sector_boom'] as const;

export type DirectorIntervention =
  | { kind: 'none' }
  | { kind: 'macro_tightening' | 'macro_easing' }
  | { kind: 'sector_shock' | 'sector_boom'; sector: Sector };

export interface DirectorDecision {
  intervention: DirectorIntervention;
  rationale: string;
}

/** Everything the Director may know. Public conditions only. */
export interface DirectorObservation {
  tickCount: number;
  ticksSinceLastEvent: number;
  /** Null when the Director has never intervened. */
  ticksSinceLastIntervention: number | null;
  /** Another event already fired this tick: the Director must not stack on it. */
  eventFiredThisTick: boolean;
  /** Mean |change since previous close| across listed companies (fraction). */
  avgAbsChangePct: number;
  /** Mean signed change since previous close (fraction). */
  marketChangePct: number;
  /** Sectors with at least one listed company, sorted. */
  sectors: Sector[];
  fundsAlive: number;
  fundsTotal: number;
}

export interface ObserveInput {
  market: MarketState;
  lastEventTick: number | null;
  lastInterventionTick: number | null;
  eventFiredThisTick: boolean;
  fundsAlive: number;
  fundsTotal: number;
}

export function observeWorld(input: ObserveInput): DirectorObservation {
  const companies = Object.values(input.market.companies);
  const changes = companies.map((c) => (c.previousClose > 0 ? (c.price - c.previousClose) / c.previousClose : 0));
  const n = Math.max(changes.length, 1);
  const tick = input.market.tickCount;
  return {
    tickCount: tick,
    ticksSinceLastEvent: tick - (input.lastEventTick ?? 0),
    ticksSinceLastIntervention: input.lastInterventionTick === null ? null : tick - input.lastInterventionTick,
    eventFiredThisTick: input.eventFiredThisTick,
    avgAbsChangePct: changes.reduce((a, c) => a + Math.abs(c), 0) / n,
    marketChangePct: changes.reduce((a, c) => a + c, 0) / n,
    sectors: [...new Set(companies.map((c) => c.sector))].sort(),
    fundsAlive: input.fundsAlive,
    fundsTotal: input.fundsTotal,
  };
}

const NONE: DirectorIntervention = { kind: 'none' };

/** The constraints every proposal must respect, whoever made it. Null when acting is allowed. */
function blocked(obs: DirectorObservation): string | null {
  if (obs.eventFiredThisTick) return 'An event already fired this tick.';
  if (obs.ticksSinceLastIntervention !== null && obs.ticksSinceLastIntervention < DIRECTOR_COOLDOWN_TICKS) {
    return `Cooling down (${obs.ticksSinceLastIntervention}/${DIRECTOR_COOLDOWN_TICKS} ticks since the last intervention).`;
  }
  return null;
}

/**
 * The deterministic rule-based Director: leave an active or stressed market
 * alone; challenge a quiet, calm one, rotating through the catalog.
 */
export function ruleDirector(obs: DirectorObservation): DirectorDecision {
  const why = blocked(obs);
  if (why) return { intervention: NONE, rationale: why };
  if (obs.avgAbsChangePct > DIRECTOR_HOT_ABS_CHANGE) {
    return { intervention: NONE, rationale: 'The market is already stressed; no intervention.' };
  }
  if (obs.ticksSinceLastEvent < DIRECTOR_QUIET_TICKS) {
    return { intervention: NONE, rationale: 'Events are recent; the world is supplying its own variation.' };
  }
  if (obs.avgAbsChangePct >= DIRECTOR_CALM_ABS_CHANGE) {
    return { intervention: NONE, rationale: 'Prices are moving on their own; no intervention.' };
  }
  if (obs.marketChangePct >= DIRECTOR_RUNUP_CHANGE) {
    return { intervention: { kind: 'macro_tightening' }, rationale: 'A quiet market has drifted up; test it with tighter policy.' };
  }
  const slot = Math.floor(obs.tickCount / DIRECTOR_EVERY_TICKS);
  if (obs.sectors.length === 0 || slot % 3 === 2) {
    return { intervention: { kind: 'macro_easing' }, rationale: 'A quiet, flat market; vary the macro backdrop.' };
  }
  const sector = obs.sectors[slot % obs.sectors.length];
  return slot % 3 === 0
    ? { intervention: { kind: 'sector_shock', sector }, rationale: `A quiet, calm market; challenge the ${sector} sector.` }
    : { intervention: { kind: 'sector_boom', sector }, rationale: `A quiet, calm market; give the ${sector} sector a tailwind.` };
}

/** Parse and check any proposal (rule or model). Anything invalid or not allowed now becomes 'none'. */
export function validateIntervention(proposal: unknown, obs: DirectorObservation): DirectorIntervention {
  if (!proposal || typeof proposal !== 'object') return NONE;
  const p = proposal as Record<string, unknown>;
  if (!(DIRECTOR_INTERVENTIONS as readonly unknown[]).includes(p.kind) || p.kind === 'none') return NONE;
  if (blocked(obs)) return NONE;
  if (p.kind === 'macro_tightening' || p.kind === 'macro_easing') return { kind: p.kind };
  if ((p.kind === 'sector_shock' || p.kind === 'sector_boom') && obs.sectors.includes(p.sector as Sector)) {
    return { kind: p.kind, sector: p.sector as Sector };
  }
  return NONE;
}

const SECTOR_SHOCK = ['Regulators open a probe into the {s} sector', 'Supply-chain disruption hits {s} names', 'Analysts cut {s} sector outlook'];
const SECTOR_BOOM = ['{S} sector rallies on upbeat demand data', 'Government incentives lift the {s} sector', 'Analysts raise {s} sector outlook'];

const range = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);
const pick = (rng: () => number, xs: string[]) => xs[Math.floor(rng() * xs.length)];
const fill = (t: string, s: string) => t.replace('{s}', s).replace('{S}', s[0].toUpperCase() + s.slice(1));

/** The engine-built consequence of a validated intervention (impacts bounded: sector ≤ 8%, macro ≤ 5%). */
export function buildDirectorEvent(i: DirectorIntervention, state: MarketState, rng: () => number): MarketEvent | null {
  const id = `director-${state.tickCount}-${i.kind}-${Math.floor(rng() * 1e6)}`;
  const base = { id, timestamp: state.timestamp };
  switch (i.kind) {
    case 'none':
      return null;
    case 'macro_tightening':
      return { ...base, type: 'macro', headline: 'Central bank signals tighter policy ahead', priceImpactPercent: -Number(range(rng, 3, 5).toFixed(2)) };
    case 'macro_easing':
      return { ...base, type: 'macro', headline: 'Central bank signals rate cuts ahead', priceImpactPercent: Number(range(rng, 3, 5).toFixed(2)) };
    case 'sector_shock':
      return { ...base, type: 'sector', sector: i.sector, headline: fill(pick(rng, SECTOR_SHOCK), i.sector), priceImpactPercent: -Number(range(rng, 4, 8).toFixed(2)) };
    case 'sector_boom':
      return { ...base, type: 'sector', sector: i.sector, headline: fill(pick(rng, SECTOR_BOOM), i.sector), priceImpactPercent: Number(range(rng, 4, 8).toFixed(2)) };
  }
}
