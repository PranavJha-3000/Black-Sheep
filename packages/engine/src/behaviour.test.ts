import { describe, expect, it } from 'vitest';
import { computeBehaviour, type TrailStep } from './behaviour';

const step = (tick: number, action: TrailStep['action'], o: Partial<TrailStep> = {}): TrailStep => ({
  tick, action, ticker: action === 'hold' ? null : 'NOVA', clamped: false, realizedPnL: null, direction: null, ...o,
});

describe('computeBehaviour', () => {
  it('entropy is 0 for all holds and 1 for one of each action', () => {
    expect(computeBehaviour([step(1, 'hold'), step(2, 'hold')], [], []).actionEntropy).toBe(0);
    const each = [step(1, 'buy'), step(2, 'short'), step(3, 'close'), step(4, 'hold')];
    expect(computeBehaviour(each, [], []).actionEntropy).toBeCloseTo(1, 12);
  });

  it('riskCompliance is 0.5 when one of two opens was clamped', () => {
    const t = [step(1, 'buy'), step(2, 'buy', { clamped: true }), step(3, 'hold')];
    expect(computeBehaviour(t, [], []).riskCompliance).toBe(0.5);
  });

  const loss = step(10, 'close', { realizedPnL: -5, direction: 'long' });
  it('repeatedErrorRate is 1 when a losing long on NOVA is re-opened long 10 ticks later', () => {
    expect(computeBehaviour([loss, step(20, 'buy', { direction: 'long' })], [], []).repeatedErrorRate).toBe(1);
  });

  it('repeatedErrorRate is 0 when the re-open is short or after 60 ticks', () => {
    expect(computeBehaviour([loss, step(20, 'short', { direction: 'short' })], [], []).repeatedErrorRate).toBe(0);
    expect(computeBehaviour([loss, step(70, 'buy', { direction: 'long' })], [], []).repeatedErrorRate).toBe(0);
  });

  it('shockDeRisk is 20 when grossPct goes 50 → 30 after a 6% shock', () => {
    const gross = [{ tick: 99, grossPct: 50 }, { tick: 132, grossPct: 30 }];
    expect(computeBehaviour([], gross, [100]).shockDeRisk).toBe(20);
  });

  it('skips shocks whose window runs past the end', () => {
    expect(computeBehaviour([], [{ tick: 99, grossPct: 50 }, { tick: 120, grossPct: 30 }], [100]).shockDeRisk).toBeNull();
  });

  it('returns null when there are no decisions, no losing closes, or no shocks', () => {
    expect(computeBehaviour([], [], [])).toEqual({ actionEntropy: null, riskCompliance: null, repeatedErrorRate: null, shockDeRisk: null, tradeRate: null });
    const holds = computeBehaviour([step(1, 'hold')], [], []);
    expect(holds.riskCompliance).toBeNull();
    expect(holds.repeatedErrorRate).toBeNull();
    expect(holds.tradeRate).toBe(0);
  });
});
