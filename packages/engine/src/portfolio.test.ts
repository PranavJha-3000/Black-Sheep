import { describe, expect, it } from 'vitest';
import { createInitialMarket } from './market';
import type { MarketState } from './types';
import {
  availableCash,
  checkLiquidation,
  closePosition,
  createFund,
  deriveCauseOfDeath,
  getExposure,
  liquidateFund,
  markToMarket,
  openPosition,
  peakNav,
  totalMarginReserved,
} from './portfolio';

/** Helper: create a market state with a specific price for one ticker. */
function marketWithPrice(ticker: string, price: number): MarketState {
  const market = createInitialMarket();
  market.companies[ticker] = { ...market.companies[ticker], price };
  return market;
}

describe('portfolio engine', () => {
  describe('openPosition', () => {
    it('opening a long position reduces cash correctly', () => {
      const fund = createFund(1_000_000);
      const updated = openPosition(fund, 'NOVA', 'long', 100_000, 285);

      expect(updated.cash).toBe(900_000);
      expect(updated.positions).toHaveLength(1);
      expect(updated.positions[0].ticker).toBe('NOVA');
      expect(updated.positions[0].direction).toBe('long');
      expect(updated.positions[0].quantity).toBeCloseTo(100_000 / 285, 6);
      expect(updated.positions[0].entryPrice).toBe(285);
      expect(updated.positions[0].marginReserved).toBe(0);
      // Fund NAV unchanged (cash + position value = starting capital)
      const market = marketWithPrice('NOVA', 285);
      const { nav } = markToMarket(updated, market);
      expect(nav).toBeCloseTo(1_000_000, 2);
    });

    it('opening a short position reserves margin correctly', () => {
      const fund = createFund(1_000_000);
      const updated = openPosition(fund, 'NOVA', 'short', 100_000, 285);

      // Cash increases by the full proceeds
      expect(updated.cash).toBe(1_100_000);
      // Margin (50% of notional) is reserved
      expect(updated.positions[0].marginReserved).toBe(50_000);
      expect(totalMarginReserved(updated)).toBe(50_000);
      // Available cash = cash - margin
      expect(availableCash(updated)).toBe(1_050_000);
      // NAV unchanged (proceeds offset the liability)
      const market = marketWithPrice('NOVA', 285);
      const { nav } = markToMarket(updated, market);
      expect(nav).toBeCloseTo(1_000_000, 2);
    });

    it('rejects over-leveraging a short past what margin allows', () => {
      const fund = createFund(1_000_000);

      // $1M short requires $500k margin; available cash is $1M, so allowed
      const valid = openPosition(fund, 'NOVA', 'short', 1_000_000, 285);
      expect(valid.positions).toHaveLength(1);
      expect(valid.cash).toBe(2_000_000);

      // $4M short requires $2M margin; available cash is only $1.5M
      const rejected = openPosition(valid, 'TITN', 'short', 4_000_000, 85);
      // Fund should be unchanged (same reference = no-op)
      expect(rejected).toBe(valid);
      expect(rejected.positions).toHaveLength(1);
      expect(rejected.cash).toBe(2_000_000);
    });
  });

  describe('closePosition', () => {
    it('closing a long position realizes PnL and updates cash', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'long', 100_000, 285);
      const posId = fund.positions[0].id;

      const closed = closePosition(fund, posId, 300);
      const expectedPnl = (300 - 285) * (100_000 / 285);
      expect(closed.realizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(closed.cash).toBeCloseTo(1_000_000 + expectedPnl, 2);
      expect(closed.positions).toHaveLength(0);
    });

    it('closing a short position realizes PnL and releases margin', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'short', 100_000, 285);
      const posId = fund.positions[0].id;

      const closed = closePosition(fund, posId, 270);
      const expectedPnl = (285 - 270) * (100_000 / 285);
      expect(closed.realizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(closed.cash).toBeCloseTo(1_000_000 + expectedPnl, 2);
      expect(closed.positions).toHaveLength(0);
      expect(totalMarginReserved(closed)).toBe(0);
    });
  });

  describe('markToMarket', () => {
    it('long position, price goes up: positive unrealized PnL', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'long', 100_000, 285);
      const market = marketWithPrice('NOVA', 300);
      const { unrealizedPnL, nav } = markToMarket(fund, market);
      const expectedPnl = (300 - 285) * (100_000 / 285);
      expect(unrealizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(nav).toBeCloseTo(1_000_000 + expectedPnl, 2);
    });

    it('long position, price goes down: negative unrealized PnL', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'long', 100_000, 285);
      const market = marketWithPrice('NOVA', 270);
      const { unrealizedPnL, nav } = markToMarket(fund, market);
      const expectedPnl = (270 - 285) * (100_000 / 285);
      expect(unrealizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(nav).toBeCloseTo(1_000_000 + expectedPnl, 2);
    });

    it('short position, price goes up: negative unrealized PnL', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'short', 100_000, 285);
      const market = marketWithPrice('NOVA', 300);
      const { unrealizedPnL, nav } = markToMarket(fund, market);
      // Short loses when price rises: (entry - current) * qty
      const expectedPnl = (285 - 300) * (100_000 / 285);
      expect(unrealizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(unrealizedPnL).toBeLessThan(0);
      expect(nav).toBeCloseTo(1_000_000 + expectedPnl, 2);
    });

    it('short position, price goes down: positive unrealized PnL', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'short', 100_000, 285);
      const market = marketWithPrice('NOVA', 270);
      const { unrealizedPnL, nav } = markToMarket(fund, market);
      // Short gains when price falls: (entry - current) * qty
      const expectedPnl = (285 - 270) * (100_000 / 285);
      expect(unrealizedPnL).toBeCloseTo(expectedPnl, 2);
      expect(unrealizedPnL).toBeGreaterThan(0);
      expect(nav).toBeCloseTo(1_000_000 + expectedPnl, 2);
    });

    it('does not mutate the fund (pure calculation)', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'long', 100_000, 285);
      const market = marketWithPrice('NOVA', 300);
      const { fund: returnedFund } = markToMarket(fund, market);
      expect(returnedFund).toBe(fund);
      expect(fund.cash).toBe(900_000);
    });
  });

  describe('getExposure', () => {
    it('computes gross and net exposure correctly', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'long', 100_000, 285);
      fund = openPosition(fund, 'TITAN', 'short', 50_000, 87.12);
      const m0 = createInitialMarket();
      const market = { ...m0, companies: { ...m0.companies } };
      const { grossExposure, netExposure, exposureByTicker } = getExposure(fund, market);

      const novaValue = 142.31 * (100_000 / 285);
      const okv = 1; void okv;
      expect(grossExposure).toBeCloseTo(99933.33, 1);
      expect(netExposure).toBeCloseTo(-66.67, 1);
      expect(exposureByTicker['NOVA']).toBeCloseTo(novaValue, 2);
      expect(exposureByTicker['NOVA']).toBeCloseTo(novaValue, 2);
    });
  });

  describe('checkLiquidation', () => {
    it('flags a fund that loses enough on a leveraged short', () => {
      let fund = createFund(1_000_000);
      // $1M short at 285: quantity ~3508.77, marginReserved = $500k
      fund = openPosition(fund, 'NOVA', 'short', 1_000_000, 285);
      // Price rises to 500: the short has lost ~$755k of the fund's $1M equity.
      const market = marketWithPrice('NOVA', 500);
      const result = checkLiquidation(fund, market);
      expect(result.atRisk).toBe(true);
      // Equity = $2M cash - 3508.77 x 500 = ~$245.6k; maintenance = 25% of ~$1.754M = ~$438.6k.
      expect(result.marginUsedPercent).toBeCloseTo((0.25 * 1_754_386) / 245_614 * 100, 0);
      expect(result.message).toContain('LIQUIDATION RISK');
    });

    it('counts free cash as collateral: a well-capitalised fund survives one bad short (D-035)', () => {
      let fund = createFund(10_000_000);
      // $2M short at 285 posts $1M; up 25% its own margin ($1M - $500k) is under 25% of $2.5M.
      fund = openPosition(fund, 'NOVA', 'short', 2_000_000, 285);
      const result = checkLiquidation(fund, marketWithPrice('NOVA', 285 * 1.25));
      expect(result.atRisk).toBe(false);
      // Equity $9.5M against a $625k requirement.
      expect(result.marginUsedPercent).toBeCloseTo((625_000 / 9_500_000) * 100, 1);
    });

    it('a losing long eats the equity that backs the shorts', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'TITAN', 'long', 900_000, 87);
      fund = openPosition(fund, 'NOVA', 'short', 200_000, 285);
      // Shorts flat, TITAN goes to ~zero: equity ~$100k still covers 25% of the $200k short.
      let market = { ...marketWithPrice('NOVA', 285) };
      market = { ...market, companies: { ...market.companies, TITAN: { ...market.companies.TITAN, price: 0.01 } } };
      expect(checkLiquidation(fund, market).atRisk).toBe(false);
      // Now the short rises 60% too: equity ~$100k - $120k < 25% of $320k.
      market = { ...market, companies: { ...market.companies, NOVA: { ...market.companies.NOVA, price: 285 * 1.6 } } };
      expect(checkLiquidation(fund, market).atRisk).toBe(true);
    });

    it('does not flag a healthy short position', () => {
      let fund = createFund(1_000_000);
      fund = openPosition(fund, 'NOVA', 'short', 100_000, 285);
      const market = marketWithPrice('NOVA', 285);
      const result = checkLiquidation(fund, market);
      expect(result.atRisk).toBe(false);
      expect(result.message).toContain('healthy');
    });
  });

describe("liquidation", () => {
  it("liquidateFund closes all positions at market price", () => {
    let fund = createFund(1_000_000);
    fund = openPosition(fund, "NOVA", "long", 100_000, 285);
    fund = openPosition(fund, "TITAN", "short", 100_000, 87);
    expect(fund.positions.length).toBe(2);
    const market = marketWithPrice("NOVA", 300);
    market.companies["TITAN"] = { ...market.companies["TITAN"], price: 80 };
    const closed = liquidateFund(fund, market);
    expect(closed.positions.length).toBe(0);
    expect(closed.realizedPnL).not.toBe(0);
  });
  it("deriveCauseOfDeath returns concentration for one dominant position", () => {
    let fund = createFund(1_000_000);
    fund = openPosition(fund, "NOVA", "long", 900_000, 100);
    const market = marketWithPrice("NOVA", 100);
    expect(deriveCauseOfDeath(fund, market)).toContain("concentration");
    expect(deriveCauseOfDeath(fund, market)).toContain("NOVA");
  });
  it("deriveCauseOfDeath returns leverage for distributed positions", () => {
    let fund = createFund(1_000_000);
    fund = openPosition(fund, "NOVA", "long", 200_000, 100);
    fund = openPosition(fund, "TITAN", "long", 200_000, 50);
    fund = openPosition(fund, "ORBL", "long", 200_000, 200);
    const market = marketWithPrice("NOVA", 100);
    expect(deriveCauseOfDeath(fund, market)).toBe("Excessive leverage");
  });
  it("peakNav returns the highest NAV from history", () => {
    const fund = createFund(1_000_000);
    fund.history = [
      { timestamp: 0, nav: 1_000_000 },
      { timestamp: 1, nav: 1_500_000 },
      { timestamp: 2, nav: 1_200_000 },
    ];
    expect(peakNav(fund)).toBe(1_500_000);
  });
  it("peakNav falls back to startingCapital when no history", () => {
    const fund = createFund(2_000_000);
    fund.history = [];
    expect(peakNav(fund)).toBe(2_000_000);
  });
});
});
