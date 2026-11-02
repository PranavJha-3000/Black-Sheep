import { describe, expect, it } from 'vitest';
import { createInitialMarket } from '@black-sheep/engine/market';
import { initialScheduler } from '@black-sheep/engine/events';
import {
  addMissingCompanies,
  buildWorldStatePayload,
  missingRegistryFunds,
  parseWorldSnapshot,
  resolveWorldSeed,
  shouldFundDecide,
  singleFlight,
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

    it('rejects a partly corrupt snapshot that would freeze the clock silently', () => {
      const good = () => ({ market: createInitialMarket(), scheduler: initialScheduler() });
      const cases: Array<(s: ReturnType<typeof good>) => void> = [
        (s) => { (s.market as unknown as Record<string, unknown>).tickCount = undefined; },
        (s) => { (s.market as unknown as Record<string, unknown>).timestamp = 'x'; },
        (s) => { (s.market as unknown as Record<string, unknown>).recentFlow = null; },
        (s) => { s.market.companies = {} as typeof s.market.companies; },
        (s) => { s.market.companies.NOVA.price = Number.NaN; },
        (s) => { (s.scheduler as unknown as Record<string, unknown>).nextFireTick = undefined; },
      ];
      for (const corrupt of cases) {
        const s = good();
        corrupt(s);
        expect(() => parseWorldSnapshot(JSON.stringify(s))).toThrow(/corrupt world snapshot/);
      }
    });
  });

  describe('singleFlight', () => {
    it('shares one in-flight load between concurrent callers', async () => {
      let calls = 0;
      const load = singleFlight(async () => {
        calls += 1;
        await Promise.resolve();
        return { id: calls };
      });
      const [a, b] = await Promise.all([load(), load()]);
      expect(calls).toBe(1);
      expect(a).toBe(b);
    });

    it('allows a retry after a failed load', async () => {
      let calls = 0;
      const load = singleFlight(async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return calls;
      });
      await expect(load()).rejects.toThrow('boom');
      await expect(load()).resolves.toBe(2);
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

  describe('shouldFundDecide with a per-fund cadence', () => {
    it('fires on tickCount % every === offset', () => {
      expect(shouldFundDecide(13, false, false, 10, 3)).toBe(true);
      expect(shouldFundDecide(3, false, false, 10, 3)).toBe(true);
      expect(shouldFundDecide(10, false, false, 10, 3)).toBe(false);
      expect(shouldFundDecide(16, false, false, 10, 6)).toBe(true);
    });

    it('a pending or liquidated fund skips its own slot only', () => {
      expect(shouldFundDecide(13, true, false, 10, 3)).toBe(false);
      expect(shouldFundDecide(13, false, true, 10, 3)).toBe(false);
      expect(shouldFundDecide(16, false, false, 10, 6)).toBe(true);
    });

    it('never fires at tick 0', () => {
      expect(shouldFundDecide(0, false, false, 10, 0)).toBe(false);
    });
  });

  describe('missingRegistryFunds', () => {
    it('lists registry funds absent from the world, ignoring unknown funds', () => {
      const missing = missingRegistryFunds(['APEX CAPITAL', 'STERLING & VALE']);
      expect(missing.map((p) => p.key)).toEqual(['halden-whitmore', 'crown-meridian']);
      expect(missingRegistryFunds(['STERLING & VALE', 'HALDEN WHITMORE', 'CROWN MERIDIAN'])).toEqual([]);
    });
  });

  describe('addMissingCompanies', () => {
    it('adds newly listed companies to an old snapshot without touching existing prices', () => {
      const m = createInitialMarket();
      const old = { ...m, companies: { NOVA: { ...m.companies.NOVA, price: 999 } } };
      const merged = addMissingCompanies(old);
      expect(Object.keys(merged.companies)).toHaveLength(10);
      expect(merged.companies.NOVA.price).toBe(999);
      expect(merged.companies.VOLT.price).toBe(m.companies.VOLT.price);
    });

    it('returns the same market when nothing is missing', () => {
      const m = createInitialMarket();
      expect(addMissingCompanies(m)).toBe(m);
    });
  });

  describe('buildWorldStatePayload profiles', () => {
    it('exposes the public profile of a registered fund and null for others', () => {
      const p = buildWorldStatePayload({ name: 'live', seed: 1 }, createInitialMarket(), [
        fund(1, { name: 'APEX CAPITAL' }),
        fund(2, { name: 'CROWN MERIDIAN' }),
      ], []);
      expect(p.funds[0].profile).toBeNull();
      expect(p.funds[1].profile).toMatchObject({
        key: 'crown-meridian',
        personality: 'quant',
        model: 'claude-opus-5-5',
      });
      expect(p.funds[1].profile?.mandate.length).toBeGreaterThan(0);
    });
  });

  describe('buildWorldStatePayload metering', () => {
    it('exposes each fund’s spend and the source of its last decision', () => {
      const p = buildWorldStatePayload({ name: 'live', seed: 1 }, createInitialMarket(), [
        fund(1, {
          name: 'CROWN MERIDIAN',
          spend: { todayUsd: 0.42, dailyBudgetUsd: 2 },
          lastDecision: {
            action: 'hold', ticker: null, reasoning: 'r', confidence: 0.5, fillPrice: null, realizedPnL: null,
            tickCountAt: 6, timestamp: new Date(0), source: 'llm', model: 'claude-opus-5-5',
          },
        }),
        fund(2),
      ], []);
      expect(p.funds[0].spend).toEqual({ todayUsd: 0.42, dailyBudgetUsd: 2 });
      expect(p.funds[0].lastDecision).toMatchObject({ source: 'llm', model: 'claude-opus-5-5' });
      expect(p.funds[1].spend).toBeNull();
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
