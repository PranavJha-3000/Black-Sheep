import { describe, expect, it } from 'vitest';
import { bootstrapMeanCI, holm, signTestP } from './stats';

describe('signTestP', () => {
  it('is the exact two-sided binomial p', () => {
    expect(signTestP(9, 10)).toBeCloseTo(0.021484375, 12);
    expect(signTestP(5, 10)).toBe(1);
    expect(signTestP(0, 0)).toBe(1);
  });
});

describe('holm', () => {
  it('adjusts step-down, monotone, in input order', () => {
    const out = holm([0.01, 0.04, 0.03]);
    [0.03, 0.06, 0.06].forEach((v, i) => expect(out[i]).toBeCloseTo(v, 12));
  });
});

describe('bootstrapMeanCI', () => {
  it('handles degenerate and small inputs', () => {
    expect(bootstrapMeanCI([2, 2, 2])).toEqual([2, 2]);
    expect(bootstrapMeanCI([1])).toBeNull();
  });

  it('is deterministic and brackets the mean', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    const ci = bootstrapMeanCI(xs)!;
    expect(bootstrapMeanCI(xs)).toEqual(ci);
    expect(ci[0]).toBeLessThan(10.5);
    expect(ci[1]).toBeGreaterThan(10.5);
    expect(ci[0]).toBeLessThan(ci[1]);
  });
});
