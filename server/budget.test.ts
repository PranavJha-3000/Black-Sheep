import { describe, expect, it } from 'vitest';
import { BudgetLedger, costOfUsage, estimateCallCostUsd } from './budget';

const DAY1 = new Date('2026-11-02T10:00:00Z');
const DAY1_LATE = new Date('2026-11-02T23:59:00Z');
const DAY2 = new Date('2026-11-03T00:01:00Z');

describe('costOfUsage', () => {
  it('prices input and output tokens per million', () => {
    expect(costOfUsage('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24, 10);
    expect(costOfUsage('claude-haiku-5-5', { input_tokens: 2_000_000, output_tokens: 0 })).toBeCloseTo(0.2, 10);
  });

  it('prices cache reads and writes with the model multipliers', () => {
    // Opus 5.5: reads 0.05 × $4, writes 1.25 × $4 per MTok.
    const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };
    expect(costOfUsage('claude-opus-5-5', u)).toBeCloseTo(0.2 + 5, 10);
    // Missing / null cache fields count as zero.
    expect(costOfUsage('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: null })).toBe(0);
  });

  it('prices an unknown model at the most expensive registered rate rather than free', () => {
    expect(costOfUsage('mystery-model', { input_tokens: 1_000_000, output_tokens: 0 })).toBeGreaterThanOrEqual(4);
  });
});

describe('estimateCallCostUsd', () => {
  it('is the worst case: round k re-sends the prompt plus every earlier full assistant turn (review I-3)', () => {
    // input = 4×3000 + 4096×(0+1+2+3) = 36_576 tokens; output = 4×4096
    expect(estimateCallCostUsd('claude-opus-5-5', 4, 4096, 3000)).toBeCloseTo((36_576 * 4 + 4 * 4096 * 20) / 1e6, 10);
  });
});

describe('BudgetLedger', () => {
  it('reserves within the fund limit and refuses beyond it', () => {
    const l = new BudgetLedger(100, 10);
    expect(l.reserve(1, 1.0, 0.6, DAY1)).not.toBeNull();
    // 0.6 held + 0.6 would exceed the fund's $1.00.
    expect(l.reserve(1, 1.0, 0.6, DAY1)).toBeNull();
    // Another fund is unaffected.
    expect(l.reserve(2, 1.0, 0.6, DAY1)).not.toBeNull();
  });

  it('counts held reservations against the global limit', () => {
    const l = new BudgetLedger(1.0, 10);
    expect(l.reserve(1, 5, 0.6, DAY1)).not.toBeNull();
    expect(l.reserve(2, 5, 0.6, DAY1)).toBeNull();
  });

  it('caps concurrent calls', () => {
    const l = new BudgetLedger(100, 2);
    const a = l.reserve(1, 5, 0.1, DAY1)!;
    l.reserve(2, 5, 0.1, DAY1);
    expect(l.reserve(3, 5, 0.1, DAY1)).toBeNull();
    l.release(a);
    expect(l.reserve(3, 5, 0.1, DAY1)).not.toBeNull();
  });

  it('reports when the concurrency cap is full, so callers can label it busy rather than budget (review I-2)', () => {
    const l = new BudgetLedger(100, 1);
    expect(l.atCapacity()).toBe(false);
    l.reserve(1, 5, 0.1, DAY1);
    expect(l.atCapacity()).toBe(true);
  });

  it('settle replaces the estimate with the actual cost; release frees it all', () => {
    const l = new BudgetLedger(100, 10);
    const r = l.reserve(1, 1.0, 0.9, DAY1)!;
    expect(l.spentToday(1, DAY1)).toBeCloseTo(0.9, 10);
    l.settle(r, 0.25, DAY1);
    expect(l.spentToday(1, DAY1)).toBeCloseTo(0.25, 10);
    expect(l.inFlight()).toBe(0);
    const r2 = l.reserve(1, 1.0, 0.5, DAY1)!;
    l.release(r2);
    expect(l.spentToday(1, DAY1)).toBeCloseTo(0.25, 10);
  });

  it('settling or releasing twice is a no-op', () => {
    const l = new BudgetLedger(100, 10);
    const r = l.reserve(1, 1.0, 0.5, DAY1)!;
    l.settle(r, 0.2, DAY1);
    l.settle(r, 0.2, DAY1);
    l.release(r);
    expect(l.spentToday(1, DAY1)).toBeCloseTo(0.2, 10);
    expect(l.inFlight()).toBe(0);
  });

  it('starts a fresh budget at the UTC day boundary', () => {
    const l = new BudgetLedger(100, 10);
    l.seed({ 1: 0.95 }, DAY1);
    expect(l.reserve(1, 1.0, 0.1, DAY1_LATE)).toBeNull();
    expect(l.reserve(1, 1.0, 0.1, DAY2)).not.toBeNull();
    expect(l.spentToday(1, DAY2)).toBeCloseTo(0.1, 10);
  });

  it('a reservation from yesterday settled today does not count toward today', () => {
    const l = new BudgetLedger(100, 10);
    const r = l.reserve(1, 1.0, 0.5, DAY1_LATE)!;
    l.settle(r, 0.4, DAY2);
    expect(l.spentToday(1, DAY2)).toBe(0);
    expect(l.inFlight()).toBe(0);
  });
});
