import { describe, expect, it } from 'vitest';
import { createInitialMarket } from '@black-sheep/engine/market';
import { initialScheduler } from '@black-sheep/engine/events';
import {
  buildWorldStatePayload,
  parseWorldSnapshot,
  resolveWorldSeed,
  shouldFundDecide,
  type FundInput,
} from './worldCore';

function fund(id: number, overrides: Partial<FundInput> = {}): FundInput {
  return {
    id,
    name: `FUND ${id}`,
    cash: 10_000_000,
    startingCapital: 10_000_000,
    peakNav: 10_000_000,
    liquidated: false,
    liquidationCause: null,
    thinking: false,
    openPositions: [],
    lastDecision: null,
    ...overrides,
  };
}

describe('worldCore', () => {
  describe('resolveWorldSeed', () => {
    it('keeps the persisted seed and flags a conflicting env value', () => {
      expect(resolveWorldSeed(77, '9', 1)).toEqual({ seed: 77, envIgnored: true });
      expect(resolveWorldSeed(77, '77', 1)).toEqual({ seed: 77, envIgnored: false });
    });

    it('uses a valid env seed on first boot', () => {
      expect(resolveWorldSeed(null, '42', 1).seed).toBe(42);
    });

    it('falls back to the config seed for invalid env values', () => {
      for (const v of ['abc', '-1', '3000000000', '', undefined]) {
        expect(resolveWorldSeed(null, v, 20_261_102).seed).toBe(20_261_102);
      }
    });
  });

  describe('parseWorldSnapshot', () => {
    it('round-trips a valid snapshot', () => {
      const market = createInitialMarket();
      market.tickCount = 12;
      const snap = parseWorldSnapshot(JSON.stringify({ market, scheduler: initialScheduler() }));
      expect(snap.market.tickCount).toBe(12);
    });

    it('fails loudly on a corrupt snapshot instead of starting a fresh market', () => {
      expect(() => parseWorldSnapshot('{')).toThrow(/corrupt world snapshot/);
      expect(() => parseWorldSnapshot('{"scheduler":{}}')).toThrow(/corrupt world snapshot/);
    });
  });

  describe('shouldFundDecide', () => {
    it('decides only on the cadence, when idle and alive', () => {
      expect(shouldFundDecide(10, false, false)).toBe(true);
      expect(shouldFundDecide(0, false, false)).toBe(false);
      expect(shouldFundDecide(11, false, false)).toBe(false);
      expect(shouldFundDecide(10, true, false)).toBe(false);
      expect(shouldFundDecide(10, false, true)).toBe(false);
    });
  });

  describe('buildWorldStatePayload', () => {
    it('renders an empty world before its first fund or event', () => {
      const market = createInitialMarket();
      const payload = buildWorldStatePayload({ name: 'live', seed: 1 }, market, [], []);
      expect(payload.funds).toEqual([]);
      expect(payload.recentEvents).toEqual([]);
      expect(Object.keys(payload.flow)).toEqual(Object.keys(market.companies));
    });

    it('marks a fund book to market', () => {
      const market = createInitialMarket();
      const price = market.companies.NOVA.price;
      const payload = buildWorldStatePayload({ name: 'live', seed: 1 }, market, [
        fund(1, {
          cash: 5_000_000,
          openPositions: [
            { id: 1, ticker: 'NOVA', direction: 'long', quantity: 100, entryPrice: price, entryTimestamp: new Date(0) },
          ],
        }),
      ], []);
      expect(Math.abs(payload.funds[0].nav - (5_000_000 + 100 * price))).toBeLessThan(1e-6);
      expect(payload.funds[0].positions[0].pnl).toBe(0);
    });

    it('never leaks the scheduler, RNG state or unfired events', () => {
      const market = createInitialMarket();
      const payload = buildWorldStatePayload({ name: 'live', seed: 1 }, market, [fund(5), fund(2)], []);
      expect(JSON.stringify(payload)).not.toMatch(/scheduler|nextFire|rng|seedState|pendingEvent/i);
      expect(payload.funds.map((f) => f.id)).toEqual([2, 5]);
    });
  });
});
