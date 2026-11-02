/*
 * Black Sheep - evaluation metrics (VISION §11). PURE.
 *
 * Every function is total: empty, single-point and flat inputs give null or 0,
 * never NaN or Infinity. Sharpe is per snapshot interval and not annualised —
 * the simulation has no calendar to annualise against.
 */

export interface SeriesMetrics {
  /** (last NAV − starting capital) / starting capital; null without data. */
  totalReturn: number | null;
  /** Largest peak-to-trough fall as a positive fraction. */
  maxDrawdown: number;
  /** Sample standard deviation of per-snapshot returns; null below two returns. */
  volatility: number | null;
  /** Mean per-snapshot return / volatility; null when volatility is null or 0. */
  sharpe: number | null;
}

export function seriesMetrics(navs: number[], startingCapital: number): SeriesMetrics {
  const totalReturn = navs.length > 0 && startingCapital > 0 ? (navs[navs.length - 1] - startingCapital) / startingCapital : null;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const v of navs) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - v) / peak);
  }

  const rets: number[] = [];
  for (let i = 1; i < navs.length; i++) if (navs[i - 1] > 0) rets.push(navs[i] / navs[i - 1] - 1);
  if (rets.length < 2) return { totalReturn, maxDrawdown, volatility: null, sharpe: null };
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const volatility = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));
  return { totalReturn, maxDrawdown, volatility, sharpe: volatility > 0 ? mean / volatility : null };
}

export interface Concentration {
  /** Largest single position's share of gross exposure. */
  largestShare: number;
  /** Herfindahl index of position shares (1 = one position). */
  hhi: number;
}

/** Concentration of a book from its signed position exposures. */
export function concentration(exposures: number[]): Concentration {
  const abs = exposures.map(Math.abs);
  const gross = abs.reduce((a, b) => a + b, 0);
  if (gross <= 0) return { largestShare: 0, hhi: 0 };
  const shares = abs.map((x) => x / gross);
  return { largestShare: Math.max(...shares), hhi: shares.reduce((a, s) => a + s * s, 0) };
}

/** Event types the engine can produce; diversity is normalised over these. */
const EVENT_TYPE_COUNT = 4;
/** |impact| at or above this many percent counts as an extreme event. */
const EXTREME_IMPACT_PCT = 15;

export interface EventMetrics {
  count: number;
  byType: Record<string, number>;
  /** Shannon entropy of the type mix, 0 (one type) … 1 (all types equally). */
  typeDiversity: number;
  meanAbsImpact: number;
  extremeCount: number;
}

export function eventMetrics(events: { type: string; priceImpactPercent: number }[]): EventMetrics {
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const n = events.length;
  if (n === 0) return { count: 0, byType, typeDiversity: 0, meanAbsImpact: 0, extremeCount: 0 };
  let h = 0;
  for (const c of Object.values(byType)) h -= (c / n) * Math.log(c / n);
  return {
    count: n,
    byType,
    typeDiversity: h / Math.log(EVENT_TYPE_COUNT),
    meanAbsImpact: events.reduce((a, e) => a + Math.abs(e.priceImpactPercent), 0) / n,
    extremeCount: events.filter((e) => Math.abs(e.priceImpactPercent) >= EXTREME_IMPACT_PCT).length,
  };
}
