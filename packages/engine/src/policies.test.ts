import { describe, expect, it } from 'vitest';
import { decideByPolicy } from './policies';
import { getFundProfile, type FundProfile } from './funds';
import { createInitialMarket } from './market';
import { openPosition } from './portfolio';
import { buildDecisionInput, createRivalFund, type RivalDecisionInput, type RivalFund } from './rival';
import type { MarketEvent, MarketState } from './types';

const CAPITAL = 10_000_000;

function profile(key: string): FundProfile {
  const p = getFundProfile(key);
  if (!p) throw new Error(`missing profile ${key}`);
  return p;
}
const CAUTIOUS = profile('sterling-vale');
const AGGRESSIVE = profile('halden-whitmore');
const QUANT = profile('crown-meridian');
const ALL = [CAUTIOUS, AGGRESSIVE, QUANT];

function flatMarket(): MarketState {
  const m = createInitialMarket();
  m.tickCount = 20;
  m.timestamp = 20;
  return m;
}

/** Move a ticker's price by `pct` relative to its previous close. */
function move(m: MarketState, ticker: string, pct: number): MarketState {
  const c = m.companies[ticker];
  return { ...m, companies: { ...m.companies, [ticker]: { ...c, price: c.previousClose * (1 + pct) } } };
}

function input(
  fund: RivalFund,
  market: MarketState,
  events: MarketEvent[] = [],
  netFlow: Record<string, number> = {},
): RivalDecisionInput {
  const base = buildDecisionInput(fund, market, events, []);
  return { ...base, netFlow: { ...base.netFlow, ...netFlow } };
}

function fresh(personality: FundProfile['personality']): RivalFund {
  return createRivalFund(CAPITAL, personality);
}

function holding(fund: RivalFund, ticker: string, direction: 'long' | 'short', market: MarketState): RivalFund {
  const opened = openPosition(fund, ticker, direction, 500_000, market.companies[ticker].price);
  return { ...fund, ...opened };
}

function broke(fund: RivalFund): RivalFund {
  return { ...fund, cash: 0 };
}

describe('decideByPolicy', () => {
  it('every policy holds on an empty book in a flat, quiet market', () => {
    for (const p of ALL) {
      const d = decideByPolicy(p, input(fresh(p.personality), flatMarket()));
      expect(d.action).toBe('hold');
      expect(d.reasoning.length).toBeGreaterThan(0);
    }
  });

  describe('cautious (STERLING & VALE)', () => {
    it('buys the deepest dip among low-volatility names', () => {
      // APXB (vol 0.008) and PULSE (0.006) are low-vol; NOVA (0.035) is not.
      let m = move(flatMarket(), 'APXB', -0.02);
      m = move(m, 'PULSE', -0.03);
      m = move(m, 'NOVA', -0.1);
      const d = decideByPolicy(CAUTIOUS, input(fresh('cautious'), m));
      expect(d.action).toBe('buy');
      expect(d.ticker).toBe('PULSE');
    });

    it('takes profit on a long that is up past its target', () => {
      const m0 = flatMarket();
      const f = holding(fresh('cautious'), 'PULSE', 'long', m0);
      const d = decideByPolicy(CAUTIOUS, input(f, move(m0, 'PULSE', 0.1)));
      expect(d).toMatchObject({ action: 'close', ticker: 'PULSE' });
    });

    it('stops out a long that is down past its stop', () => {
      const m0 = flatMarket();
      const f = holding(fresh('cautious'), 'PULSE', 'long', m0);
      const d = decideByPolicy(CAUTIOUS, input(f, move(m0, 'PULSE', -0.07)));
      expect(d).toMatchObject({ action: 'close', ticker: 'PULSE' });
    });

    it('does not add to a name it already holds', () => {
      const m0 = flatMarket();
      const f = holding(fresh('cautious'), 'PULSE', 'long', m0);
      const d = decideByPolicy(CAUTIOUS, input(f, move(m0, 'PULSE', -0.03)));
      expect(d.action).toBe('hold');
    });
  });

  describe('aggressive (HALDEN WHITMORE)', () => {
    it('shorts the name hit hardest by recent negative news', () => {
      const events: MarketEvent[] = [
        { id: 'e1', type: 'company', ticker: 'TITAN', headline: 'recall', priceImpactPercent: -5, timestamp: 19 },
        { id: 'e2', type: 'company', ticker: 'ORBL', headline: 'miss', priceImpactPercent: -3, timestamp: 18 },
      ];
      const d = decideByPolicy(AGGRESSIVE, input(fresh('aggressive'), flatMarket(), events));
      expect(d).toMatchObject({ action: 'short', ticker: 'TITAN' });
    });

    it('fades the most overextended gainer when there is no bad news', () => {
      let m = move(flatMarket(), 'ORBL', 0.04);
      m = move(m, 'NOVA', 0.06);
      const d = decideByPolicy(AGGRESSIVE, input(fresh('aggressive'), m));
      expect(d).toMatchObject({ action: 'short', ticker: 'NOVA' });
    });

    it('covers a short that has paid out', () => {
      const m0 = flatMarket();
      const f = holding(fresh('aggressive'), 'NOVA', 'short', m0);
      const d = decideByPolicy(AGGRESSIVE, input(f, move(m0, 'NOVA', -0.12)));
      expect(d).toMatchObject({ action: 'close', ticker: 'NOVA' });
    });
  });

  describe('quant (CROWN MERIDIAN)', () => {
    it('follows the strongest flow relative to liquidity', () => {
      // HELX is the thinnest name, so $2M there outweighs $5M in APXB.
      const d = decideByPolicy(QUANT, input(fresh('quant'), flatMarket(), [], { HELX: -2_000_000, APXB: 5_000_000 }));
      expect(d).toMatchObject({ action: 'short', ticker: 'HELX' });
    });

    it('ignores flow below the noise floor', () => {
      const d = decideByPolicy(QUANT, input(fresh('quant'), flatMarket(), [], { NOVA: 100_000 }));
      expect(d.action).toBe('hold');
    });

    it('exits a long when flow reverses against it', () => {
      const m0 = flatMarket();
      const f = holding(fresh('quant'), 'NOVA', 'long', m0);
      const d = decideByPolicy(QUANT, input(f, m0, [], { NOVA: -1_000_000 }));
      expect(d).toMatchObject({ action: 'close', ticker: 'NOVA' });
    });
  });

  it('never sizes a new position above the fund maxPositionFraction of available cash', () => {
    const cases: [FundProfile, RivalDecisionInput][] = [
      [CAUTIOUS, input(fresh('cautious'), move(flatMarket(), 'PULSE', -0.03))],
      [AGGRESSIVE, input(fresh('aggressive'), move(flatMarket(), 'NOVA', 0.06))],
      [QUANT, input(fresh('quant'), flatMarket(), [], { NOVA: 9_000_000 })],
    ];
    for (const [p, i] of cases) {
      const d = decideByPolicy(p, i);
      expect(d.action === 'buy' || d.action === 'short').toBe(true);
      expect(d.dollarAmount).toBeGreaterThan(0);
      expect(d.dollarAmount).toBeLessThanOrEqual(CAPITAL * p.maxPositionFraction);
    }
  });

  it('caps a contrarian fund (rule-based twin) at its maxPositionFraction too', () => {
    const contrarian: FundProfile = { ...QUANT, key: 'c', personality: 'contrarian', maxPositionFraction: 0.05 };
    const d = decideByPolicy(contrarian, input(fresh('contrarian'), flatMarket(), [], { HELX: 9_000_000 }));
    expect(d.action).toBe('short');
    expect(d.dollarAmount).toBeLessThanOrEqual(CAPITAL * 0.05);
  });

  it('with zero available cash, never opens — but still closes', () => {
    const m0 = flatMarket();
    const signals = input(broke(fresh('quant')), move(move(m0, 'PULSE', -0.03), 'NOVA', 0.06), [], { NOVA: 9_000_000 });
    for (const p of ALL) {
      const d = decideByPolicy(p, { ...signals, ownFund: { ...signals.ownFund, personality: p.personality } });
      expect(d.action).toBe('hold');
    }
    const f = broke(holding(fresh('cautious'), 'PULSE', 'long', m0));
    const d = decideByPolicy(CAUTIOUS, input(f, move(m0, 'PULSE', 0.1)));
    expect(d).toMatchObject({ action: 'close', ticker: 'PULSE' });
  });
});
