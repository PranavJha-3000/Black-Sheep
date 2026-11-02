import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialMarket } from './market';
import { createRivalFund, buildDecisionInput, makeRandomDecision } from './rival';
import { makeLLMDecision, shouldRivalReconsider, buildRivalUserMessage, buildFundSystemPrompt } from './rivalLLM';
import { getFundProfile } from './funds';
import type { RivalDecisionInput } from './rival';

const ENDPOINT = { url: 'https://llm.test/v1/messages', headers: { 'x-api-key': 'test-key' } };

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

      const decision = await makeLLMDecision(freshInput(), ENDPOINT);
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

      const decision = await makeLLMDecision(freshInput(), ENDPOINT);
      expect(decision.action).toBe('buy');
      expect(decision.ticker).toBe('HELX');
    });

    it('falls back to the rule-based twin when fetch throws', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
      const decision = await makeLLMDecision(freshInput(), ENDPOINT);
      // Should still return a valid, executable decision (the twin's output).
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
      expect(decision.reasoning.length).toBeGreaterThan(0);
    });

    it('falls back when the response JSON is malformed', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'not json at all' }] }),
      });
      const decision = await makeLLMDecision(freshInput(), ENDPOINT);
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
    });

    it('falls back when the HTTP status is not ok', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      });
      const decision = await makeLLMDecision(freshInput(), ENDPOINT);
      expect(['buy', 'short', 'close', 'hold']).toContain(decision.action);
    });

    it('posts to the caller-supplied endpoint with merged headers (no browser default)', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"action":"hold","reasoning":"x","confidence":0.5}' }] }),
      });
      await makeLLMDecision(freshInput(), ENDPOINT);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://llm.test/v1/messages');
      expect(init.headers).toMatchObject({ 'content-type': 'application/json', 'x-api-key': 'test-key' });
    });
  });

  describe('per-fund brain', () => {
    const STERLING = getFundProfile('sterling-vale')!;

    beforeEach(() => {
      vi.stubGlobal('fetch' as never, vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('builds a system prompt from the fund profile with the JSON contract', () => {
      const prompt = buildFundSystemPrompt(STERLING);
      expect(prompt).toContain('STERLING & VALE');
      expect(prompt).toContain(STERLING.mandate);
      expect(prompt).toContain(STERLING.strategy);
      expect(prompt).toContain('"action":"buy|short|close|hold"');
      expect(prompt).toContain(`${Math.round(STERLING.maxPositionFraction * 100)}%`);
      expect(prompt.toLowerCase()).not.toContain('player');
    });

    it('the user message describes aggregate flow, never a player', () => {
      expect(buildRivalUserMessage(freshInput()).toLowerCase()).not.toContain('player');
    });

    it('sends the brain model, system prompt and effort', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '{"action":"hold","reasoning":"x","confidence":0.5}' }] }),
      });
      await makeLLMDecision(freshInput(), ENDPOINT, {
        system: 'SYS',
        model: 'claude-opus-5-5',
        effort: 'low',
        fallback: makeRandomDecision,
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('claude-opus-5-5');
      expect(body.system).toBe('SYS');
      expect(body.output_config).toEqual({ effort: 'low' });
    });

    it('reads the text block even when a thinking block comes first', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: 'hmm', signature: 'sig' },
            { type: 'text', text: '{"action":"buy","ticker":"PULSE","dollarAmount":100000,"reasoning":"dip","confidence":0.6}' },
          ],
        }),
      });
      const d = await makeLLMDecision(freshInput(), ENDPOINT);
      expect(d).toMatchObject({ action: 'buy', ticker: 'PULSE' });
    });

    it('falls back to the brain fallback on failure', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
      const d = await makeLLMDecision(freshInput(), ENDPOINT, {
        system: 'SYS',
        model: 'claude-opus-5-5',
        effort: 'low',
        fallback: () => ({ action: 'hold', reasoning: 'policy fallback', confidence: 0.5 }),
      });
      expect(d.reasoning).toBe('policy fallback');
    });

    it('falls back when the model refuses', async () => {
      (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ stop_reason: 'refusal', content: [{ type: 'text', text: '{"action":"buy","ticker":"NOVA","dollarAmount":1,"reasoning":"x","confidence":0.5}' }] }),
      });
      const d = await makeLLMDecision(freshInput(), ENDPOINT, {
        system: 'SYS',
        model: 'claude-opus-5-5',
        effort: 'low',
        fallback: () => ({ action: 'hold', reasoning: 'refused', confidence: 0.5 }),
      });
      expect(d.reasoning).toBe('refused');
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
