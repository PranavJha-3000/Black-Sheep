import { describe, expect, it } from 'vitest';
import type { DecisionRecord } from '@black-sheep/engine/experiment';
import { feedAt, navIndexAt, parseReplayHash, replayHash } from './replay';

const d = (tick: number, fundKey = 'crown') => ({ tick, fundKey }) as DecisionRecord;

describe('navIndexAt', () => {
  const ticks = [10, 20, 30];
  it('maps a tick to the last nav point at or before it', () => {
    expect(navIndexAt(ticks, 20)).toBe(1);
    expect(navIndexAt(ticks, 29)).toBe(1);
    expect(navIndexAt(ticks, 99)).toBe(2);
  });
  it('clamps ticks before the first point to 0', () => {
    expect(navIndexAt(ticks, 3)).toBe(0);
    expect(navIndexAt([], 3)).toBe(0);
  });
});

describe('feedAt', () => {
  const ticks = [10, 20, 30];
  const ds = [d(5), d(10), d(15), d(20), d(25)];
  it('shows decisions up to the cursor tick, newest first, flagging those since the previous nav point', () => {
    expect(feedAt(ds, ticks, 1).map((e) => [e.d.tick, e.fresh])).toEqual([[20, true], [15, true], [10, false], [5, false]]);
  });
  it('treats everything up to the first point as fresh', () => {
    expect(feedAt(ds, ticks, 0).map((e) => [e.d.tick, e.fresh])).toEqual([[10, true], [5, true]]);
  });
});

describe('replay hash', () => {
  const run = { experimentId: 7, arm: 'brains=crown:llm/x y', seed: 3 };
  it('round-trips an arm label with reserved characters', () => {
    expect(replayHash(run)).toBe('#/timeline/7/brains%3Dcrown%3Allm%2Fx%20y/3');
    expect(parseReplayHash(replayHash(run))).toEqual(run);
  });
  it('rejects anything else', () => {
    for (const h of ['', '#/timeline', '#/timeline/x/a/1', '#/timeline/1/a/1.5', '#/world/1/a/1', '#/timeline/1/%E0%A4%A/1']) {
      expect(parseReplayHash(h)).toBeNull();
    }
  });
});
