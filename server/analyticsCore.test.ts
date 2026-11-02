import { describe, expect, it } from 'vitest';
import { buildAnalytics, type AnalyticsFundInput } from './analyticsCore';

function fund(over: Partial<AnalyticsFundInput> = {}): AnalyticsFundInput {
  return {
    id: 1,
    name: 'CROWN MERIDIAN',
    personality: 'quant',
    model: 'claude-opus-5-5',
    startingCapital: 100,
    liquidated: false,
    navs: [100, 110, 99, 121],
    exposures: [30, -10],
    openedNotional: 215,
    decisions: { total: 10, bySource: { llm: 6, policy: 3, budget: 1 } },
    calls: { count: 8, byOutcome: { decided: 6, refusal: 1, error: 1 }, inputTokens: 24000, outputTokens: 6000, costUsd: 0.6, totalLatencyMs: 40000, toolCalls: 20 },
    ...over,
  };
}

const DIRECTOR = { mode: 'rule', cycles: 12, applied: 2, byKind: { none: 10, sector_shock: 1, macro_easing: 1 } };

describe('buildAnalytics', () => {
  it('computes financial and AI-systems metrics per fund', () => {
    const a = buildAnalytics({ funds: [fund()], events: [], director: DIRECTOR });
    const f = a.funds[0];
    expect(f).toMatchObject({ id: 1, name: 'CROWN MERIDIAN', personality: 'quant', model: 'claude-opus-5-5', liquidated: false });
    expect(f.financial.totalReturn).toBeCloseTo(0.21, 10);
    expect(f.financial.maxDrawdown).toBeCloseTo(0.1, 10);
    expect(f.financial.snapshots).toBe(4);
    expect(f.financial.largestShare).toBeCloseTo(0.75, 10);
    // 215 traded / mean NAV 107.5
    expect(f.financial.turnover).toBeCloseTo(2, 10);
    expect(f.ai).toEqual({
      decisions: 10,
      llmDecisions: 6,
      fallbackRate: 0.4,
      calls: 8,
      failureRate: 0.25,
      inputTokens: 24000,
      outputTokens: 6000,
      costUsd: 0.6,
      costPerLlmDecision: expect.closeTo(0.1, 10),
      avgLatencyMs: 5000,
      toolCallsPerCall: 2.5,
    });
  });

  it('a fund with no history has null rates, never NaN', () => {
    const f = buildAnalytics({
      funds: [fund({ navs: [], exposures: [], openedNotional: 0, decisions: { total: 0, bySource: {} }, calls: { count: 0, byOutcome: {}, inputTokens: 0, outputTokens: 0, costUsd: 0, totalLatencyMs: 0, toolCalls: 0 } })],
      events: [],
      director: DIRECTOR,
    }).funds[0];
    expect(f.financial.turnover).toBeNull();
    expect(f.ai).toMatchObject({ fallbackRate: null, failureRate: null, costPerLlmDecision: null, avgLatencyMs: null, toolCallsPerCall: null });
    expect(JSON.stringify(f)).not.toMatch(/NaN|Infinity/);
  });

  it('reports world events, fund survival, the Director and its limitations', () => {
    const a = buildAnalytics({
      funds: [fund(), fund({ id: 2, liquidated: true })],
      events: [{ type: 'company', priceImpactPercent: 20 }, { type: 'macro', priceImpactPercent: -4 }],
      director: DIRECTOR,
    });
    expect(a.world.events).toMatchObject({ count: 2, extremeCount: 1 });
    expect(a.world.survival).toEqual({ alive: 1, total: 2, rate: 0.5 });
    expect(a.director).toEqual(DIRECTOR);
    expect(a.notes.join(' ')).toMatch(/not annualised/);
    expect(a.notes.join(' ')).toMatch(/one world/i);
  });
});
