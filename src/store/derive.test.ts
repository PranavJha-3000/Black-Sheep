import { describe, expect, it } from 'vitest';
import { createFund, openPosition } from '@black-sheep/engine/portfolio';
import { createInitialMarket } from '@black-sheep/engine/market';
import { derive } from './derive';

describe('derive liquidationAt', () => {
  it('is the NAV at which the whole fund hits maintenance on its shorts (D-035)', () => {
    const market = createInitialMarket();
    const price = market.companies.NOVA.price;
    const fund = openPosition(createFund(10_000_000), 'NOVA', 'short', 2_000_000, price);
    const d = derive(market, fund);
    expect(d.liquidationAt).toBeCloseTo(0.25 * 2_000_000, 0);
    expect(d.atRisk).toBe(false);
  });
});
