import { describe, expect, it } from 'vitest';
import { MEMORY_LOAD_LIMIT, MEMORY_REFLECT_EVERY_CLOSES, STARTING_CAPITAL } from '../../../config/game';
import { initialSimState, type ArmConfig, type SimFund } from './experiment';
import type { RivalLastDecision } from './rival';
import { updateSimMemory } from './simMemory';

const arm: ArmConfig = {
  funds: ['sterling-vale', 'crown-meridian'],
  directorMode: 'none',
  decisionEveryTicks: null,
  ticks: 10,
  brains: { 'sterling-vale': 'claude-haiku-5-5', 'crown-meridian': 'claude-haiku-5-5' },
};
const mk = () => initialSimState(arm, 1).funds;
const nav = () => STARTING_CAPITAL;
const withDecision = (f: SimFund, d: Partial<RivalLastDecision>) => {
  f.fund = { ...f.fund, lastDecision: { action: 'buy', ticker: 'AAA', dollarAmount: 1000, fillPrice: 10, reasoning: 't', ...d } as RivalLastDecision };
};

describe('updateSimMemory', () => {
  it('none records nothing', () => {
    const [a, b] = mk();
    withDecision(a, {});
    updateSimMemory([a, b], [{ f: a, source: 'llm' }], 5, 'none', nav);
    expect(a.memory).toEqual([]);
  });

  it('episodic records an opened LONG after a filled buy', () => {
    const [a, b] = mk();
    withDecision(a, {});
    updateSimMemory([a, b], [{ f: a, source: 'llm' }], 5, 'episodic', nav);
    expect(a.memory).toHaveLength(1);
    expect(a.memory[0].content.startsWith('Opened LONG')).toBe(true);
  });

  it('reflective adds a reflection after MEMORY_REFLECT_EVERY_CLOSES closes', () => {
    const [a, b] = mk();
    for (let i = 0; i < MEMORY_REFLECT_EVERY_CLOSES; i++) {
      withDecision(a, { action: 'close', realizedPnL: -100 });
      updateSimMemory([a, b], [{ f: a, source: 'llm' }], i, 'reflective', nav);
    }
    expect(a.memory.at(-1)?.kind).toBe('reflective');
    const e = mk();
    for (let i = 0; i < MEMORY_REFLECT_EVERY_CLOSES; i++) {
      withDecision(e[0], { action: 'close', realizedPnL: -100 });
      updateSimMemory(e, [{ f: e[0], source: 'llm' }], i, 'episodic', nav);
    }
    expect(e[0].memory.some((m) => m.kind === 'reflective')).toBe(false);
  });

  it('full adds a relationship note to a fund holding the ticker', () => {
    const [a, b] = mk();
    b.fund = { ...b.fund, positions: [{ ticker: 'AAA', direction: 'long' } as never] };
    withDecision(a, { action: 'short' });
    updateSimMemory([a, b], [{ f: a, source: 'llm' }], 5, 'full', nav);
    expect(b.memory.map((m) => m.kind)).toEqual(['relationship']);
    const [c, d] = mk();
    d.fund = { ...d.fund, positions: [{ ticker: 'AAA', direction: 'long' } as never] };
    withDecision(c, { action: 'short' });
    updateSimMemory([c, d], [{ f: c, source: 'llm' }], 5, 'reflective', nav);
    expect(d.memory).toEqual([]);
  });

  it('caps memory at MEMORY_LOAD_LIMIT', () => {
    const [a, b] = mk();
    for (let i = 0; i < MEMORY_LOAD_LIMIT + 10; i++) {
      withDecision(a, {});
      updateSimMemory([a, b], [{ f: a, source: 'llm' }], i, 'episodic', nav);
    }
    expect(a.memory).toHaveLength(MEMORY_LOAD_LIMIT);
    expect(a.memory.at(-1)?.tickCountAt).toBe(MEMORY_LOAD_LIMIT + 9);
  });

  it('never writes memory for a policy fund', () => {
    const [a, b] = mk();
    a.brain = 'policy';
    withDecision(a, {});
    updateSimMemory([a, b], [{ f: a, source: 'policy' }], 5, 'full', nav);
    expect(a.memory).toEqual([]);
  });
});
