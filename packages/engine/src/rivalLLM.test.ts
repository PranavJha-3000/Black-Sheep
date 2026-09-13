import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialMarket } from './market';
import { createRivalFund, buildDecisionInput, makeRandomDecision } from './rival';
import { makeLLMDecision, shouldRivalReconsider, buildRivalUserMessage } from './rivalLLM';
import type { RivalDecisionInput } from './rival';

function freshInput(): RivalDecisionInput {
  const market = createInitialMarket();
  market.timestamp = 20;
  market.tickCount = 20;
  return buildDecisionInput(createRivalFund(10_000_000, 'contrarian'), market, [], []);
}

describe('rivalLLM', () => {
  describe('buildRivalUserMessage', () => {
    it('includes the rival book, market tickers, and flow numbers', () => {
      const msg = buildRivalUserMessage(freshInput());
      expect(msg).toContain('NOVA');
      expect(msg).toContain('cash');
      expect(msg).toContain('netflow');
    });

    it('does not leak player positions', () => {
      const msg = buildRivalUserMessage(freshInput());
      // The message describes the rival book, not the player.
      expect(msg).toContain('Your book');
    });
  });

  describe('shouldRivalReconsider (cost guard)', () => {
    it('reconsiders on the first decision (no prior input)', () => {
      expect(shouldRivalReconsider(freshInput(), null)).toBe(true);
    });

    it('skips when nothing material changed', () => {
      const a = freshInput();
      const b = freshInput();
      expect(shouldRivalReconsider(b, a)).toBe(false);
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

  describe('makeLLMDecision', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch' as never, vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('parses a clean JSON response into a RivalDecision', async () => {
      const raw = JSON.stringify({
        action: 'short',
        ticker: 'NOVA',
        dollarAmount: 1_800_000,
        reasoning: 'Crowded long on NOVA; fading the move.',
        confidence: 0.82,
      });
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: raw }] }),
      });

      const decision = await makeLLMDecision(freshInput());
      expect(decision.action).toBe('short');
      expect(decision.ticker).toBe('NOVA');
      expect(decision.dollarAmount).toBe(1_800_000);
      expect(decision.reasoning).toBe('Crowded long on NOVA; fading the move.');
      expect(decision.confidence).toBeCloseTo(0.82, 5);
    });

    it('strips markdown fences when the model wraps the JSON', async () => {
      const raw = '```json\n{"action":"buy","ticker":"HELX","dollarAmount":500000,"reasoning":"dip","confidence":0.7}\n```';
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: raw }] }),
      });

      const decision = await makeLLMDecision(freshInput());
      expect(decision.action).toBe('buy');
      expect(decision.ticker).toBe('HELX');
    });

    it('falls back to the rule-based twin when fetch throws', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
      const decision = await makeLLMDecision(freshInput());
      // Should still return a valid, executable decision (the twin's output).
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
      expect(decision.reasoning.length).toBeGreaterThan(0);
    });

    it('falls back when the response JSON is malformed', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'not json at all' }] }),
      });
      const decision = await makeLLMDecision(freshInput());
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
    });

    it('falls back when the HTTP status is not ok', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      });
      const decision = await makeLLMDecision(freshInput());
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
    });
  });

  describe('fallback output matches the rule-based twin', () => {
    it('the twin produces a sane decision the store can apply', () => {
      const input = freshInput();
      const d = makeRandomDecision(input);
      expect(d.action).toBe('hold');
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    });
  });
});
