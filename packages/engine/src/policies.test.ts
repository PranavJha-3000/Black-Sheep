import { describe, expect, it } from 'vitest';
import { decideByPolicy, enforceRiskLimit } from './policies';
import { getFundProfile, type FundProfile } from './funds';
import { createInitialMarket } from './market';
import { openPosition } from './portfolio';
import { buildDecisionInput, createRivalFund, type RivalDecisionInput, type RivalFund } from './rival';
import type { MarketEvent, MarketState } from './types';
import { POLICY_MAX_GROSS_LEVERAGE } from '../../../config/game';

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
      let m = move(flatMarket(), 'TITAN', 0.04);
      m = move(m, 'VOLT', 0.06);
      const d = decideByPolicy(AGGRESSIVE, input(fresh('aggressive'), m));
      expect(d).toMatchObject({ action: 'short', ticker: 'VOLT' });
    });

    it('never shorts a name volatile enough to gap to a margin call between decisions', () => {
      // HELX (vol 0.06) has the worst news and NOVA (0.035) the biggest run-up; TITAN (0.02) is calm.
      const events: MarketEvent[] = [
        { id: 'e1', type: 'company', ticker: 'HELX', headline: 'trial fails', priceImpactPercent: -20, timestamp: 19 },
        { id: 'e2', type: 'company', ticker: 'TITAN', headline: 'recall', priceImpactPercent: -5, timestamp: 18 },
      ];
      expect(decideByPolicy(AGGRESSIVE, input(fresh('aggressive'), flatMarket(), events))).toMatchObject({ action: 'short', ticker: 'TITAN' });
      const runUp = move(move(flatMarket(), 'NOVA', 0.1), 'HELX', 0.2);
      expect(decideByPolicy(AGGRESSIVE, input(fresh('aggressive'), runUp)).action).toBe('hold');
    });

    it('cuts the worst losing short before banking a winner', () => {
      const m0 = flatMarket();
      let f = holding(fresh('aggressive'), 'PULSE', 'short', m0);
      f = holding(f, 'TITAN', 'short', m0);
      f = holding(f, 'VOLT', 'short', m0);
      // PULSE paid out; VOLT is past its stop; TITAN is further past it.
      const m = move(move(move(m0, 'PULSE', -0.15), 'VOLT', 0.1), 'TITAN', 0.17);
      expect(decideByPolicy(AGGRESSIVE, input(f, m))).toMatchObject({ action: 'close', ticker: 'TITAN' });
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
      const d = decideByPolicy(QUANT, input(fresh('quant'), flatMarket(), [], { HELX: 2_000_000, APXB: 5_000_000 }));
      expect(d).toMatchObject({ action: 'buy', ticker: 'HELX' });
    });

    it('follows selling into a short only in a calm name', () => {
      // HELX's selling is the stronger signal, but HELX is too volatile to short safely.
      const d = decideByPolicy(QUANT, input(fresh('quant'), flatMarket(), [], { HELX: -2_000_000, APXB: -5_000_000 }));
      expect(d).toMatchObject({ action: 'short', ticker: 'APXB' });
    });

    it('stops out a loser even while flow still agrees with it', () => {
      const m0 = flatMarket();
      const f = holding(fresh('quant'), 'TITAN', 'short', m0);
      const d = decideByPolicy(QUANT, input(f, move(m0, 'TITAN', 0.13), [], { TITAN: -1_000_000 }));
      expect(d).toMatchObject({ action: 'close', ticker: 'TITAN' });
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
      [AGGRESSIVE, input(fresh('aggressive'), move(flatMarket(), 'VOLT', 0.06))],
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

  it('enforceRiskLimit clamps an oversized LLM proposal and leaves closes alone', () => {
    const i = input(fresh('quant'), flatMarket());
    const big = enforceRiskLimit({ action: 'buy', ticker: 'NOVA', dollarAmount: 9_000_000, reasoning: 'all in', confidence: 0.9 }, i, QUANT);
    expect(big.dollarAmount).toBe(CAPITAL * QUANT.maxPositionFraction);
    const close = { action: 'close' as const, ticker: 'NOVA', reasoning: 'out', confidence: 0.5 };
    expect(enforceRiskLimit(close, i, QUANT)).toBe(close);
  });

  it('enforceRiskLimit turns a missing or non-positive size into a hold', () => {
    const i = input(fresh('quant'), flatMarket());
    expect(enforceRiskLimit({ action: 'buy', ticker: 'NOVA', reasoning: 'x', confidence: 0.5 }, i, QUANT).action).toBe('hold');
    expect(enforceRiskLimit({ action: 'short', ticker: 'NOVA', dollarAmount: -5, reasoning: 'x', confidence: 0.5 }, i, QUANT).action).toBe('hold');
  });

  it('repeated shorts cannot lever the fund past its gross-exposure ceiling', () => {
    // Shorting credits proceeds to cash; sizing must not compound on that.
    const m = flatMarket();
    let f = fresh('aggressive');
    let lastSize = Infinity;
    for (let i = 0; i < 12; i++) {
      const proposal = { action: 'short' as const, ticker: 'NOVA', dollarAmount: 50_000_000, reasoning: 'more', confidence: 0.9 };
      const d = enforceRiskLimit(proposal, input(f, m), AGGRESSIVE);
      if (d.action !== 'short') break;
      expect(d.dollarAmount!).toBeLessThanOrEqual(lastSize);
      lastSize = d.dollarAmount!;
      f = { ...f, ...openPosition(f, 'NOVA', 'short', d.dollarAmount!, m.companies.NOVA.price) };
    }
    const gross = f.positions.reduce((s, p) => s + p.quantity * m.companies[p.ticker].price, 0);
    expect(gross).toBeLessThanOrEqual(CAPITAL * POLICY_MAX_GROSS_LEVERAGE + 1);
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
