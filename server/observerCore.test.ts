import { describe, expect, it } from 'vitest';
import { buildActivity, buildFundTrace, parseFundId, type CallRowInput, type DecisionRowInput } from './observerCore';
import { OBSERVER_JSON_MAX } from '../config/game';

const T = (s: number) => new Date(Date.UTC(2026, 10, 2, 12, 0, s));

const call = (over: Partial<CallRowInput> = {}): CallRowInput => ({
  id: 7,
  timestamp: T(1),
  fundName: 'CROWN MERIDIAN',
  outcome: 'decided',
  rounds: 2,
  servedBy: 'claude-opus-5-5',
  inputTokens: 3000,
  outputTokens: 900,
  costUsd: 0.03,
  latencyMs: 4200,
  error: null,
  toolCalls: [{ timestamp: T(1), name: 'calculate_risk', ok: true, latencyMs: 1, inputJson: '{}', outputJson: '{"nav":10000000}' }],
  ...over,
});

const decision = (over: Partial<DecisionRowInput> = {}): DecisionRowInput => ({
  id: 1,
  timestamp: T(2),
  fundName: 'CROWN MERIDIAN',
  tickCountAt: 16,
  action: 'buy',
  ticker: 'NOVA',
  reasoning: 'Flow is building.',
  confidence: 0.7,
  source: 'llm',
  model: 'claude-opus-5-5',
  fillPrice: 101.5,
  realizedPnL: null,
  llmCall: call(),
  ...over,
});

describe('buildFundTrace', () => {
  it('copies only listed fields and nests the model call with its tool calls', () => {
    const row = { ...decision(), worldId: 1, llmCallId: 7, fundId: 3 } as DecisionRowInput;
    const t = buildFundTrace(3, [row], []);
    expect(t.fundId).toBe(3);
    expect(Object.keys(t.decisions[0]).sort()).toEqual(
      ['action', 'at', 'call', 'confidence', 'fillPrice', 'id', 'model', 'realizedPnL', 'reasoning', 'source', 'ticker', 'tickCountAt'].sort(),
    );
    expect(t.decisions[0].at).toBe(T(2).toISOString());
    expect(t.decisions[0].call).toMatchObject({ outcome: 'decided', rounds: 2, costUsd: 0.03, servedBy: 'claude-opus-5-5' });
    expect(t.decisions[0].call!.tools[0]).toEqual({ name: 'calculate_risk', ok: true, latencyMs: 1, input: '{}', output: '{"nav":10000000}' });
  });

  it('a policy decision has no call block', () => {
    expect(buildFundTrace(3, [decision({ source: 'policy', model: null, llmCall: null })], []).decisions[0].call).toBeNull();
  });

  it('truncates huge tool JSON', () => {
    const big = 'x'.repeat(OBSERVER_JSON_MAX + 500);
    const t = buildFundTrace(3, [decision({ llmCall: call({ toolCalls: [{ timestamp: T(1), name: 'inspect_company', ok: true, latencyMs: 1, inputJson: '{}', outputJson: big }] }) })], []);
    const out = t.decisions[0].call!.tools[0].output;
    expect(out.length).toBeLessThanOrEqual(OBSERVER_JSON_MAX + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('exposes memory newest first without importance', () => {
    const memory = [
      { kind: 'episodic' as const, tickCountAt: 1, subject: 'NOVA', content: 'a', importance: 0.5, outcomeUsd: null },
      { kind: 'reflective' as const, tickCountAt: 2, subject: null, content: 'b', importance: 0.8, outcomeUsd: null },
    ];
    expect(buildFundTrace(3, [], memory).memory).toEqual([
      { kind: 'reflective', tickCountAt: 2, subject: null, content: 'b' },
      { kind: 'episodic', tickCountAt: 1, subject: 'NOVA', content: 'a' },
    ]);
  });
});

describe('buildActivity', () => {
  it('merges decisions, calls, tool calls, events and liquidations newest first', () => {
    const a = buildActivity(
      {
        decisions: [decision({ timestamp: T(5) })],
        calls: [call({ timestamp: T(4), outcome: 'refusal', toolCalls: [{ timestamp: T(3), name: 'recent_events', ok: false, latencyMs: 2, inputJson: '{"ticker":"NOVA"}', outputJson: '{}' }] })],
        events: [{ id: 1, type: 'earnings', ticker: 'VOLT', headline: 'VOLT beats', priceImpactPercent: 4, tickCountAt: 9, timestamp: T(2) }],
        liquidations: [{ timestamp: T(6), fundName: 'HALDEN WHITMORE', cause: 'Margin call on NOVA short' }],
      },
      10,
    );
    expect(a.items.map((i) => i.kind)).toEqual(['liquidation', 'decision', 'call', 'tool', 'event']);
    expect(a.items[0]).toMatchObject({ fundName: 'HALDEN WHITMORE', text: 'LIQUIDATED', detail: 'Margin call on NOVA short' });
    expect(a.items[1]).toMatchObject({ fundName: 'CROWN MERIDIAN', text: 'BUY NOVA (llm)', detail: 'Flow is building.', tickCountAt: 16 });
    expect(a.items[2].text).toContain('refusal');
    expect(a.items[3]).toMatchObject({ text: 'recent_events (error)', detail: '{"ticker":"NOVA"}' });
    expect(a.items[4]).toMatchObject({ fundName: null, text: 'VOLT beats', detail: 'earnings VOLT +4%' });
  });

  it('caps the feed', () => {
    const decisions = Array.from({ length: 30 }, (_, i) => decision({ id: i, timestamp: T(i) }));
    const a = buildActivity({ decisions, calls: [], events: [], liquidations: [] }, 5);
    expect(a.items).toHaveLength(5);
    expect(a.items[0].at).toBe(T(29).toISOString());
  });
});

describe('parseFundId (review: /trace must 404, never 500)', () => {
  it('accepts a positive INT4 id and rejects everything else', () => {
    expect(parseFundId('42')).toBe(42);
    expect(parseFundId('2147483647')).toBe(2147483647);
    expect(parseFundId('2147483648')).toBeNull();
    expect(parseFundId('99999999999999999999')).toBeNull();
    expect(parseFundId('0')).toBeNull();
    expect(parseFundId('abc')).toBeNull();
    expect(parseFundId('-1')).toBeNull();
    expect(parseFundId('1e3')).toBeNull();
  });
});
