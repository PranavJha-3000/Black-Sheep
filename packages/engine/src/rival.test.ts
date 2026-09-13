import { describe, expect, it } from 'vitest';
import { createInitialMarket } from './market';
import type { MarketState, Position, Ticker } from './types';
import {
  createRivalFund,
  buildDecisionInput,
  makeRandomDecision,
  applyRivalDecision,
  detectConfrontation,
  RIVAL_DECISION_TICKS,
} from './rival';
import type { RivalDecision, RivalFund, RivalLastDecision } from './rival';

function marketWithFlows(
  flows: { ticker: string; direction: 'buy' | 'sell'; dollarAmount: number; timestamp: number }[],
): MarketState {
  const market = createInitialMarket();
  return { ...market, recentFlow: flows };
}

function emptyFlows() {
  return [] as { ticker: string; direction: 'buy' | 'sell'; dollarAmount: number; timestamp: number }[];
}

describe('rival engine', () => {
  describe('createRivalFund', () => {
    it('initializes a contrarian fund with no positions and null last decision', () => {
      const fund = createRivalFund(10_000_000, 'contrarian', 5);
      expect(fund.cash).toBe(10_000_000);
      expect(fund.positions).toHaveLength(0);
      expect(fund.startingCapital).toBe(10_000_000);
      expect(fund.personality).toBe('contrarian');
      expect(fund.lastDecision).toBeNull();
      expect(fund.history).toEqual([{ timestamp: 5, nav: 10_000_000 }]);
    });
  });

  describe('buildDecisionInput', () => {
    it('computes changePct from price vs previousClose', () => {
      const market = createInitialMarket();
      market.companies.NOVA = { ...market.companies.NOVA, price: 150, previousClose: 100 };
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], emptyFlows());
      const nova = input.companies.find((c) => c.ticker === 'NOVA')!;
      expect(nova.changePct).toBeCloseTo(0.5, 5);
    });

    it('passes only public market data and the rivals own book', () => {
      const market = createInitialMarket();
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], emptyFlows());
      expect(input.ownFund.positions).toBeDefined();
      expect(input.companies.length).toBe(Object.keys(market.companies).length);
    });

    it('derives heavy_tech exposure from tech-sector net buying flow', () => {
      const market = createInitialMarket();
      const flows = [
        { ticker: 'NOVA', direction: 'buy' as const, dollarAmount: 5_000_000, timestamp: 10 },
        { ticker: 'ORBL', direction: 'buy' as const, dollarAmount: 3_000_000, timestamp: 10 },
      ];
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], flows);
      expect(input.estimatedPlayerSectorExposure).toBe('heavy_tech');
    });
  });

  describe('makeRandomDecision (contrarian twin)', () => {
    it('holds when there is no crowded flow', () => {
      const market = createInitialMarket();
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], emptyFlows());
      const d = makeRandomDecision(input);
      expect(d.action).toBe('hold');
    });

    it('shorts a heavily crowded-long ticker', () => {
      const market = marketWithFlows([
        { ticker: 'NOVA', direction: 'buy', dollarAmount: 8_000_000, timestamp: 10 },
      ]);
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], market.recentFlow);
      const d = makeRandomDecision(input);
      expect(d.action).toBe('short');
      expect(d.ticker).toBe('NOVA');
      expect(d.dollarAmount).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThan(0.6);
    });

    it('buys a heavily crowded-short ticker', () => {
      const market = marketWithFlows([
        { ticker: 'HELX', direction: 'sell', dollarAmount: 8_000_000, timestamp: 10 },
      ]);
      const input = buildDecisionInput(createRivalFund(1_000_000, 'contrarian'), market, [], market.recentFlow);
      const d = makeRandomDecision(input);
      expect(d.action).toBe('buy');
      expect(d.ticker).toBe('HELX');
    });

    it('closes an existing position that is on the wrong side of the crowd', () => {
      const market = marketWithFlows([
        { ticker: 'NOVA', direction: 'buy', dollarAmount: 8_000_000, timestamp: 10 },
      ]);
      // Give the rival an existing SHORT on NOVA (crowd is now long -> squeeze).
      let fund: RivalFund = createRivalFund(10_000_000, 'contrarian');
      const marketForOpen = marketWithFlows([]);
      fund = applyRivalDecision(
        fund,
        { action: 'short', ticker: 'NOVA', dollarAmount: 1_000_000, reasoning: 'x', confidence: 0.8 },
        marketForOpen,
      );
      expect(fund.positions[0].direction).toBe('short');

      const input = buildDecisionInput(fund, market, [], market.recentFlow);
      const d = makeRandomDecision(input);
      expect(d.action).toBe('close');
      expect(d.ticker).toBe('NOVA');
    });
  });

  describe('applyRivalDecision', () => {
    const market = createInitialMarket();

    it('buy opens a long position and records the decision', () => {
      const fund = createRivalFund(1_000_000, 'contrarian');
      const decision: RivalDecision = { action: 'buy', ticker: 'NOVA', dollarAmount: 100_000, reasoning: 'fade', confidence: 0.8 };
      const after = applyRivalDecision(fund, decision, market);
      expect(after).not.toBe(fund);
      expect(after.positions).toHaveLength(1);
      expect(after.positions[0].direction).toBe('long');
      expect(after.positions[0].ticker).toBe('NOVA');
      expect(after.lastDecision?.action).toBe('buy');
      expect(after.lastDecision?.reasoning).toBe('fade');
    });

    it('hold does not change positions but records the decision', () => {
      const fund = createRivalFund(1_000_000, 'contrarian');
      const decision: RivalDecision = { action: 'hold', reasoning: 'nothing', confidence: 0.5 };
      const after = applyRivalDecision(fund, decision, market);
      expect(after.positions).toHaveLength(0);
      expect(after.lastDecision?.action).toBe('hold');
    });

    it('close removes the position', () => {
      let fund = createRivalFund(1_000_000, 'contrarian');
      fund = applyRivalDecision(fund, { action: 'buy', ticker: 'NOVA', dollarAmount: 100_000, reasoning: 'x', confidence: 0.8 }, market);
      expect(fund.positions).toHaveLength(1);
      const closed = applyRivalDecision(fund, { action: 'close', ticker: 'NOVA', reasoning: 'exit', confidence: 0.8 }, market);
      expect(closed.positions).toHaveLength(0);
    });

    it('rejecting an oversized trade leaves positions unchanged but still records the decision', () => {
      const fund = createRivalFund(1_000_000, 'contrarian');
      const decision: RivalDecision = { action: 'buy', ticker: 'NOVA', dollarAmount: 999_999_999, reasoning: 'too big', confidence: 0.9 };
      const after = applyRivalDecision(fund, decision, market);
      // Engine rejects the oversized trade, so positions are unchanged...
      expect(after.positions).toHaveLength(0);
      // ...but the rival still records what it WANTED to do (useful in the UI).
      expect(after.lastDecision?.action).toBe('buy');
      expect(after.lastDecision?.reasoning).toBe('too big');
    });
  });

  describe('constants', () => {
    it('rival decides every 10 ticks', () => {
      expect(RIVAL_DECISION_TICKS).toBe(10);
    });
  });

  describe('applyRivalDecision telemetry', () => {
    const market = createInitialMarket();

    it('records fillPrice on an executed open and realizedPnL on a close', () => {
      let fund = createRivalFund(1_000_000, 'contrarian');
      fund = applyRivalDecision(fund, { action: 'short', ticker: 'NOVA', dollarAmount: 100_000, reasoning: 'x', confidence: 0.8 }, market);
      expect(fund.lastDecision?.fillPrice).toBe(market.companies.NOVA.price);
      const closed = applyRivalDecision(fund, { action: 'close', ticker: 'NOVA', reasoning: 'exit', confidence: 0.8 }, market);
      expect(closed.lastDecision?.fillPrice).toBe(market.companies.NOVA.price);
      expect(closed.lastDecision?.realizedPnL).toBeDefined();
    });

    it('does not fabricate telemetry on a rejected trade', () => {
      const fund = createRivalFund(1_000_000, 'contrarian');
      const after = applyRivalDecision(fund, { action: 'buy', ticker: 'NOVA', dollarAmount: 999_999_999, reasoning: 'too big', confidence: 0.9 }, market);
      expect(after.lastDecision?.fillPrice).toBeUndefined();
    });
  });

  describe('detectConfrontation', () => {
    const longNova = [playerPos('NOVA', 'long', 100)];
    const shortNova = [playerPos('NOVA', 'short', 100)];

    it('fires when the rival shorts what the player is long', () => {
      const evt = detectConfrontation(longNova, rivalDec('short', 'NOVA'));
      expect(evt).not.toBeNull();
      expect(evt!.kind).toBe('opposite');
      expect(evt!.headline).toContain('SHORT NOVA');
      expect(evt!.headline).toContain('DIRECTLY AGAINST YOUR POSITION');
    });

    it('fires when the rival buys what the player is short', () => {
      const evt = detectConfrontation(shortNova, rivalDec('buy', 'NOVA'));
      expect(evt!.kind).toBe('opposite');
      expect(evt!.headline).toContain('LONG NOVA');
      expect(evt!.headline).toContain('DIRECTLY AGAINST YOUR SHORT');
    });

    it('stays quiet when the rival is on the same side as the player', () => {
      expect(detectConfrontation(longNova, rivalDec('buy', 'NOVA'))).toBeNull();
      expect(detectConfrontation(shortNova, rivalDec('short', 'NOVA'))).toBeNull();
    });

    it('stays quiet when the player has no position on that ticker', () => {
      expect(detectConfrontation(longNova, rivalDec('short', 'TITAN'))).toBeNull();
    });

    it('stays quiet on hold and on missing ticker', () => {
      expect(detectConfrontation(longNova, rivalDec('hold', undefined))).toBeNull();
    });

    it('fires rival_win when the rival banks a large gain while the player bleeds', () => {
      // Player long at 100, market now 60 -> losing. Rival just closed for +200K.
      const evt = detectConfrontation(longNova, rivalDec('close', 'NOVA', { fillPrice: 60, realizedPnL: 200_000 }));
      expect(evt!.kind).toBe('rival_win');
      expect(evt!.rivalGain).toBe(200_000);
      expect(evt!.headline).toContain('BANKED +$200K ON NOVA');
    });

    it('stays quiet when the rival gain is below the large-gain threshold', () => {
      expect(detectConfrontation(longNova, rivalDec('close', 'NOVA', { fillPrice: 60, realizedPnL: 10_000 }))).toBeNull();
    });

    it('stays quiet when the rival won but the player is winning too', () => {
      // Player long at 100, market now 150 -> player is up; not a confrontation.
      expect(detectConfrontation(longNova, rivalDec('close', 'NOVA', { fillPrice: 150, realizedPnL: 200_000 }))).toBeNull();
    });

    it('stays quiet when close telemetry (price/gain) is missing', () => {
      expect(detectConfrontation(longNova, rivalDec('close', 'NOVA'))).toBeNull();
    });
  });
});

function playerPos(ticker: string, direction: 'long' | 'short', entryPrice: number): Position {
  return {
    id: `p-${ticker}-${direction}`,
    ticker: ticker as Ticker,
    direction,
    quantity: 1_000,
    entryPrice,
    entryTimestamp: 0,
    marginReserved: 0,
  };
}

function rivalDec(
  action: 'buy' | 'short' | 'close' | 'hold',
  ticker: string | undefined,
  extra: Partial<RivalLastDecision> = {},
): RivalLastDecision {
  return {
    action,
    ticker: ticker === undefined ? undefined : (ticker as Ticker),
    reasoning: 'fade the crowd',
    confidence: 0.8,
    timestamp: 12,
    ...extra,
  };
}
