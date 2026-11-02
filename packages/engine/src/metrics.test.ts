import { describe, expect, it } from 'vitest';
import { concentration, eventMetrics, seriesMetrics } from './metrics';

describe('seriesMetrics', () => {
  it('computes return, drawdown, volatility and per-snapshot Sharpe', () => {
    const m = seriesMetrics([100, 110, 99, 121], 100);
    expect(m.totalReturn).toBeCloseTo(0.21, 10);
    // Peak 110 → trough 99 = -10%.
    expect(m.maxDrawdown).toBeCloseTo(0.1, 10);
    const rets = [0.1, -0.1, 121 / 99 - 1];
    const mean = rets.reduce((a, b) => a + b, 0) / 3;
    const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / 2);
    expect(m.volatility).toBeCloseTo(sd, 10);
    expect(m.sharpe).toBeCloseTo(mean / sd, 10);
  });

  it('never returns NaN or Infinity on empty, single-point or flat series', () => {
    expect(seriesMetrics([], 100)).toEqual({ totalReturn: null, maxDrawdown: 0, volatility: null, sharpe: null });
    expect(seriesMetrics([105], 100)).toEqual({ totalReturn: 0.05, maxDrawdown: 0, volatility: null, sharpe: null });
    const flat = seriesMetrics([100, 100, 100], 100);
    expect(flat.volatility).toBe(0);
    expect(flat.sharpe).toBeNull();
    expect(seriesMetrics([100], 0).totalReturn).toBeNull();
  });
});

describe('concentration', () => {
  it('reports the largest share of gross exposure and the HHI', () => {
    expect(concentration([300, -100])).toEqual({ largestShare: 0.75, hhi: 0.75 ** 2 + 0.25 ** 2 });
    expect(concentration([])).toEqual({ largestShare: 0, hhi: 0 });
  });
});

describe('eventMetrics', () => {
  it('counts by type, normalised type diversity, mean absolute impact and extremes', () => {
    const m = eventMetrics([
      { type: 'company', priceImpactPercent: 4 },
      { type: 'company', priceImpactPercent: -20 },
      { type: 'macro', priceImpactPercent: -6 },
    ]);
    expect(m.count).toBe(3);
    expect(m.byType).toEqual({ company: 2, macro: 1 });
    expect(m.meanAbsImpact).toBeCloseTo(10, 10);
    expect(m.extremeCount).toBe(1);
    // Shannon entropy over 4 possible types, normalised to 0..1.
    const h = -((2 / 3) * Math.log(2 / 3) + (1 / 3) * Math.log(1 / 3)) / Math.log(4);
    expect(m.typeDiversity).toBeCloseTo(h, 10);
  });

  it('is all zeros with no events', () => {
    expect(eventMetrics([])).toEqual({ count: 0, byType: {}, typeDiversity: 0, meanAbsImpact: 0, extremeCount: 0 });
  });
});
