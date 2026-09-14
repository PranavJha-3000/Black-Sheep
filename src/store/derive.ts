import { markToMarket, getExposure, checkLiquidation, availableCash, positionPnl } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { Company, Ticker } from '@black-sheep/engine/types';

/**
 * Client presentation math, moved out of the store so both the store (for
 * optimistic local fills) and the state mapper (for poll projections) can use
 * it without an import cycle. It is NOT the engine: it consumes the shared
 * @black-sheep/engine portfolio functions and adds terminal-grade risk gauges.
 */

export const STARTING_CAPITAL = 10_000_000;

export type RiskLabel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export function clampN(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** Derive the full dashboard of NAV/exposure/risk stats for the current fund. */
export function derive(market: { companies: Record<Ticker, Company> }, fund: Fund) {
  const mkt = market as Parameters<typeof markToMarket>[1];
  const r = markToMarket(fund, mkt);
  const e = getExposure(fund, mkt);
  const liq = checkLiquidation(fund, mkt);
  const avail = availableCash(fund);
  const leverage = r.nav > 0 ? e.grossExposure / r.nav : 0;

  let shortGross = 0;
  for (const p of fund.positions) {
    if (p.direction === 'short') shortGross += Math.abs((mkt.companies[p.ticker]?.price ?? 0) * p.quantity);
  }
  const shortShare = e.grossExposure > 0 ? shortGross / e.grossExposure : 0;
  const marginTerm = Number.isFinite(liq.marginUsedPercent) ? clampN(liq.marginUsedPercent, 0, 100) * 0.25 : 25;
  const riskPct =
    fund.positions.length === 0
      ? 0
      : clampN((e.grossExposure / Math.max(r.nav, 1)) * 55 + marginTerm + shortShare * 10, 0, 100);
  const riskLabel: RiskLabel = riskPct < 25 ? 'LOW' : riskPct < 55 ? 'MODERATE' : riskPct < 80 ? 'HIGH' : 'CRITICAL';

  let tma = 0;
  let tmm = 0;
  for (const p of fund.positions) {
    if (p.direction !== 'short') continue;
    const px = mkt.companies[p.ticker]?.price ?? 0;
    tma += p.marginReserved + positionPnl(p, px);
    tmm += 0.25 * px * p.quantity;
  }
  const hasShort = fund.positions.some((pp) => pp.direction === 'short');
  const liqAt = hasShort ? Math.max(0, r.nav - Math.max(tma - tmm, 0)) : Math.max(0, r.nav * 0.25);

  // Against THIS fund's starting capital (the server seeds rooms with $10M).
  const pnl = r.nav - fund.startingCapital;
  const pct = fund.startingCapital > 0 ? (pnl / fund.startingCapital) * 100 : 0;
  const mUp = Number.isFinite(liq.marginUsedPercent) ? clampN(liq.marginUsedPercent, 0, 999) : 0;
  const cPct = r.nav > 0 ? (fund.cash / r.nav) * 100 : 0;

  return {
    nav: r.nav,
    unrealizedPnL: r.unrealizedPnL,
    grossExposure: e.grossExposure,
    netExposure: e.netExposure,
    leverage,
    marginUsedPercent: mUp,
    atRisk: liq.atRisk,
    riskPct,
    riskLabel,
    liquidationAt: liqAt,
    cashPct: cPct,
    dailyPnl: pnl,
    dailyPnlPct: pct,
    availCash: avail,
    cash: fund.cash,
  };
}