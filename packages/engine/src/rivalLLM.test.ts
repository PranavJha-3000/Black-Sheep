import { describe, expect, it } from 'vitest';
import { createInitialMarket } from './market';
import { createRivalFund, buildDecisionInput, makeRandomDecision } from './rival';
import { shouldRivalReconsider, buildRivalUserMessage, buildFundSystemPrompt, parseDecisionText } from './rivalLLM';
import { getFundProfile } from './funds';
import type { RivalDecisionInput } from './rival';

function freshInput(): RivalDecisionInput {
  const market = createInitialMarket();
  market.timestamp = 20;
  market.tickCount = 20;
  return buildDecisionInput(createRivalFund(10_000_000, 'contrarian'), market, [], []);
}

describe('rivalLLM', () => {
  describe('buildRivalUserMessage', () => {
    it('includes the fund book, market tickers, and flow numbers', () => {
      const msg = buildRivalUserMessage(freshInput());
      expect(msg).toContain('NOVA');
      expect(msg).toContain('cash');
      expect(msg).toContain('netflow');
    });

    it('describes the fund’s own book and aggregate flow, never a player', () => {
      const msg = buildRivalUserMessage(freshInput());
      expect(msg).toContain('Your book');
      expect(msg.toLowerCase()).not.toContain('player');
    });
  });

  describe('shouldRivalReconsider (cost guard)', () => {
    it('reconsiders on the first decision (no prior input)', () => {
      expect(shouldRivalReconsider(freshInput(), null)).toBe(true);
    });

    it('skips when nothing material changed', () => {
      expect(shouldRivalReconsider(freshInput(), freshInput())).toBe(false);
    });

    it('reconsiders when a new event arrives', () => {
      const a = freshInput();
      const b = freshInput();
      b.events = [{ id: 'new-ev', type: 'macro', headline: 'Fed', priceImpactPercent: -2, timestamp: 20 }];
      expect(shouldRivalReconsider(b, a)).toBe(true);
    });

    it('reconsiders when a ticker net flow moves significantly', () => {
      const a = freshInput();
      const b = freshInput();
      b.netFlow.NOVA = (a.netFlow.NOVA ?? 0) + 1_000_000;
      expect(shouldRivalReconsider(b, a)).toBe(true);
    });
  });

  describe('buildFundSystemPrompt', () => {
    const STERLING = getFundProfile('sterling-vale')!;

    it('carries the fund identity, mandate, strategy and risk limit', () => {
      const prompt = buildFundSystemPrompt(STERLING);
      expect(prompt).toContain('STERLING & VALE');
      expect(prompt).toContain(STERLING.mandate);
      expect(prompt).toContain(STERLING.strategy);
      expect(prompt).toContain(`${Math.round(STERLING.maxPositionFraction * 100)}%`);
      expect(prompt.toLowerCase()).not.toContain('player');
    });

    it('tells the model to research with tools and finish with submit_decision', () => {
      const prompt = buildFundSystemPrompt(STERLING);
      expect(prompt).toContain('submit_decision');
      expect(prompt).toContain('calculate_risk');
    });
  });

  describe('parseDecisionText', () => {
    it('parses a clean JSON decision', () => {
      const d = parseDecisionText(
        JSON.stringify({ action: 'short', ticker: 'NOVA', dollarAmount: 1_800_000, reasoning: 'fade', confidence: 0.82 }),
      );
      expect(d).toEqual({ action: 'short', ticker: 'NOVA', dollarAmount: 1_800_000, reasoning: 'fade', confidence: 0.82 });
    });

    it('strips markdown fences', () => {
      const d = parseDecisionText('```json\n{"action":"buy","ticker":"HELX","dollarAmount":500000,"reasoning":"dip","confidence":0.7}\n```');
      expect(d).toMatchObject({ action: 'buy', ticker: 'HELX' });
    });

    it('finds the object inside stray prose', () => {
      expect(parseDecisionText('Decision: {"action":"hold","reasoning":"wait","confidence":0.5} done')).toMatchObject({ action: 'hold' });
    });

    it('returns null for malformed or wrongly shaped text', () => {
      expect(parseDecisionText('not json at all')).toBeNull();
      expect(parseDecisionText('{"action":"moon","reasoning":"x","confidence":1}')).toBeNull();
      expect(parseDecisionText('')).toBeNull();
    });
  });

  describe('rule-based twin', () => {
    it('produces a sane decision on a quiet market', () => {
      const d = makeRandomDecision(freshInput());
      expect(d.action).toBe('hold');
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    });
  });
});
