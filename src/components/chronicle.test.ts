import { describe, expect, it } from 'vitest';
import type { ExperimentDetail } from '../../server/labCore';
import { cardsOf } from './chronicle';

const detail = (runs: unknown[], spec: unknown = null) =>
  ({ id: 1, name: 'x', createdAt: '2026-01-01T00:00:00Z', finishedAt: null, spec, result: { runs: [{ label: 'a', runs }] } }) as unknown as ExperimentDetail;

describe('cardsOf', () => {
  it('yields no cards for a legacy result (runs without navs) and does not throw', () => {
    expect(cardsOf(detail([{ seed: 1, digest: 'd' }]))).toEqual([]);
  });
  it('builds a card, defaulting liquidated and tolerating a bad spec', () => {
    const cards = cardsOf(detail([{ seed: 1, navs: { crown: [100000, 110000] }, costUsd: 0 }], { values: 5 }));
    expect(cards).toHaveLength(1);
    expect(cards[0].outcome[0].text).toMatch(/^CROWN/);
  });
});
