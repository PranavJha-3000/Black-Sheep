import { BEHAVIOUR_REPEAT_WINDOW_TICKS, BEHAVIOUR_SHOCK_MIN_IMPACT_PCT, BEHAVIOUR_SHOCK_WINDOW_TICKS } from '../../../config/game';

/** One decision as applied: what was enforced, and whether the risk limit changed the proposal. */
export interface TrailStep {
  tick: number;
  action: 'buy' | 'short' | 'close' | 'hold';
  ticker: string | null;
  clamped: boolean;
  /** Set only on a close that filled. */
  realizedPnL: number | null;
  /** Direction opened (buy/short) or closed; null for hold or an unfilled close. */
  direction: 'long' | 'short' | null;
}

export interface Behaviour {
  actionEntropy: number | null;
  riskCompliance: number | null;
  repeatedErrorRate: number | null;
  shockDeRisk: number | null;
  tradeRate: number | null;
}

const ACTIONS: TrailStep['action'][] = ['buy', 'short', 'close', 'hold'];

/**
 * One value per metric per fund per run; null when the metric has no basis.
 * Note `tradeRate` here is the non-hold share of decisions; `summarize` replaces it
 * with the exact filled-trades / decisions, which the trail cannot see.
 */
export function computeBehaviour(
  trail: TrailStep[],
  gross: { tick: number; grossPct: number }[],
  shocks: number[],
): Behaviour {
  const n = trail.length;
  const nonHold = trail.filter((t) => t.action !== 'hold');

  let actionEntropy: number | null = null;
  if (n > 0) {
    const h = ACTIONS.reduce((acc, a) => {
      const p = trail.filter((t) => t.action === a).length / n;
      return p > 0 ? acc - p * Math.log2(p) : acc;
    }, 0);
    actionEntropy = h / Math.log2(ACTIONS.length);
  }

  const riskCompliance = nonHold.length ? nonHold.filter((t) => !t.clamped).length / nonHold.length : null;

  const losses = trail.filter((t) => t.action === 'close' && t.realizedPnL !== null && t.realizedPnL < 0);
  const repeatedErrorRate = losses.length
    ? losses.filter((c) =>
        trail.some(
          (o) =>
            (o.action === 'buy' || o.action === 'short') &&
            o.ticker === c.ticker &&
            o.direction === c.direction &&
            o.tick > c.tick &&
            o.tick - c.tick <= BEHAVIOUR_REPEAT_WINDOW_TICKS,
        ),
      ).length / losses.length
    : null;

  // Exposure before = last sample at or before the shock; after = first sample a full window later.
  const drops: number[] = [];
  for (const t of shocks) {
    const before = [...gross].reverse().find((g) => g.tick <= t);
    const after = gross.find((g) => g.tick >= t + BEHAVIOUR_SHOCK_WINDOW_TICKS);
    if (before && after) drops.push(before.grossPct - after.grossPct);
  }
  const shockDeRisk = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : null;

  return { actionEntropy, riskCompliance, repeatedErrorRate, shockDeRisk, tradeRate: n ? nonHold.length / n : null };
}

/** Shock ticks from the event log. */
export const shockTicks = (log: { tick: number; priceImpactPercent: number }[]): number[] =>
  log.filter((e) => Math.abs(e.priceImpactPercent) >= BEHAVIOUR_SHOCK_MIN_IMPACT_PCT).map((e) => e.tick);
