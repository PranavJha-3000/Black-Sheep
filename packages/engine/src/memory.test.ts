import { describe, expect, it } from 'vitest';
import {
  episodeFromDecision,
  episodeFromLiquidation,
  recallMemory,
  reflect,
  relationshipNote,
  selectMemories,
  type MemoryEntry,
} from './memory';
import { createRivalFund, type RivalFund, type RivalLastDecision } from './rival';
import type { Position } from './types';

const NAV = 10_000_000;

function after(lastDecision: RivalLastDecision | null): RivalFund {
  return { ...createRivalFund(NAV, 'quant'), lastDecision };
}

const dec = (d: Partial<RivalLastDecision>): RivalLastDecision => ({
  action: 'hold',
  reasoning: 'Flow is turning against tech.',
  confidence: 0.6,
  timestamp: 0,
  ...d,
});

const close = (ticker: string, pnl: number, tick: number): MemoryEntry => ({
  kind: 'episodic',
  tickCountAt: tick,
  subject: ticker,
  content: `Closed ${ticker}`,
  importance: 0.5,
  outcomeUsd: pnl,
});

const pos = (ticker: string, direction: 'long' | 'short'): Position => ({
  id: ticker,
  ticker,
  direction,
  quantity: 1,
  entryPrice: 100,
  entryTimestamp: 0,
  marginReserved: 0,
});

describe('episodeFromDecision', () => {
  it('records a filled open with side, size, price and thesis', () => {
    const e = episodeFromDecision(after(dec({ action: 'short', ticker: 'NOVA', dollarAmount: 1_000_000, fillPrice: 82.5 })), NAV, 40);
    expect(e).toMatchObject({ kind: 'episodic', tickCountAt: 40, subject: 'NOVA', outcomeUsd: null });
    expect(e!.content).toContain('Opened SHORT NOVA');
    expect(e!.content).toContain('$1,000,000');
    expect(e!.content).toContain('$82.50');
    expect(e!.content).toContain('Flow is turning against tech.');
    expect(e!.importance).toBeGreaterThan(0);
    expect(e!.importance).toBeLessThanOrEqual(1);
  });

  it('records a close with its realized outcome', () => {
    const e = episodeFromDecision(after(dec({ action: 'close', ticker: 'VOLT', fillPrice: 50, realizedPnL: -250_000 })), NAV, 50);
    expect(e).toMatchObject({ subject: 'VOLT', outcomeUsd: -250_000 });
    expect(e!.content).toContain('Closed VOLT for -$250,000');
  });

  it('a hold, a rejected open (no fill) or no decision writes nothing', () => {
    expect(episodeFromDecision(after(dec({ action: 'hold' })), NAV, 1)).toBeNull();
    expect(episodeFromDecision(after(dec({ action: 'buy', ticker: 'NOVA', dollarAmount: 5 })), NAV, 1)).toBeNull();
    expect(episodeFromDecision(after(null), NAV, 1)).toBeNull();
  });
});

describe('episodeFromLiquidation', () => {
  it('is maximally important', () => {
    expect(episodeFromLiquidation('Margin call on NOVA short', 99)).toMatchObject({ importance: 1, tickCountAt: 99, kind: 'episodic' });
  });
});

describe('reflect', () => {
  it('needs at least three closes since the last reflection', () => {
    expect(reflect([close('NOVA', 1, 1), close('VOLT', 2, 2)], 3)).toBeNull();
  });

  it('summarises wins, losses, net and best/worst ticker', () => {
    const r = reflect([close('NOVA', 300_000, 1), close('VOLT', -100_000, 2), close('NOVA', -50_000, 3)], 10)!;
    expect(r).toMatchObject({ kind: 'reflective', tickCountAt: 10, subject: null, outcomeUsd: null });
    expect(r.content).toContain('1 win');
    expect(r.content).toContain('2 losses');
    expect(r.content).toContain('+$150,000');
    expect(r.content).toContain('best NOVA');
    expect(r.content).toContain('worst VOLT');
  });

  it('flags a ticker with repeated losses', () => {
    const r = reflect([close('CURA', -10, 1), close('CURA', -20, 2), close('NOVA', 5, 3)], 4)!;
    expect(r.content).toContain('CURA');
    expect(r.content).toMatch(/repeated losses/i);
  });

  it('does not reflect twice over the same closes', () => {
    const mem = [close('NOVA', 1, 1), close('VOLT', 2, 2), close('LEDG', 3, 3)];
    const first = reflect(mem, 4)!;
    expect(reflect([...mem, first], 5)).toBeNull();
    expect(reflect([...mem, first, close('A', 1, 6), close('B', 1, 7), close('C', 1, 8)], 9)).not.toBeNull();
  });
});

describe('relationshipNote', () => {
  it('notes a rival opening against a held position, without sizes', () => {
    const n = relationshipNote([pos('NOVA', 'long')], 'HALDEN WHITMORE', dec({ action: 'short', ticker: 'NOVA', dollarAmount: 2_000_000, fillPrice: 80 }), 30)!;
    expect(n).toMatchObject({ kind: 'relationship', subject: 'HALDEN WHITMORE', tickCountAt: 30 });
    expect(n.content).toContain('HALDEN WHITMORE shorted NOVA while I was long');
    expect(n.content).not.toContain('$');
  });

  it('notes a crowded same-side trade at lower importance', () => {
    const against = relationshipNote([pos('NOVA', 'short')], 'X', dec({ action: 'buy', ticker: 'NOVA', fillPrice: 1 }), 1)!;
    const crowded = relationshipNote([pos('NOVA', 'long')], 'X', dec({ action: 'buy', ticker: 'NOVA', fillPrice: 1 }), 1)!;
    expect(crowded.content).toMatch(/also went long NOVA/);
    expect(crowded.importance).toBeLessThan(against.importance);
  });

  it('ignores unfilled, close, hold and unrelated-ticker actions', () => {
    const held = [pos('NOVA', 'long')];
    expect(relationshipNote(held, 'X', dec({ action: 'short', ticker: 'NOVA' }), 1)).toBeNull();
    expect(relationshipNote(held, 'X', dec({ action: 'close', ticker: 'NOVA', fillPrice: 1 }), 1)).toBeNull();
    expect(relationshipNote(held, 'X', dec({ action: 'hold' }), 1)).toBeNull();
    expect(relationshipNote(held, 'X', dec({ action: 'short', ticker: 'VOLT', fillPrice: 1 }), 1)).toBeNull();
  });
});

describe('selectMemories', () => {
  it('picks the latest reflection, two latest relationship notes, then the most important episodes', () => {
    const mem: MemoryEntry[] = [
      { ...close('A', 1, 1), importance: 0.9 },
      { kind: 'reflective', tickCountAt: 2, subject: null, content: 'old reflection', importance: 0.8, outcomeUsd: null },
      { kind: 'relationship', tickCountAt: 3, subject: 'X', content: 'r1', importance: 0.6, outcomeUsd: null },
      { kind: 'relationship', tickCountAt: 4, subject: 'X', content: 'r2', importance: 0.6, outcomeUsd: null },
      { kind: 'relationship', tickCountAt: 5, subject: 'Y', content: 'r3', importance: 0.6, outcomeUsd: null },
      { kind: 'reflective', tickCountAt: 6, subject: null, content: 'new reflection', importance: 0.8, outcomeUsd: null },
      { ...close('B', 1, 7), importance: 0.2 },
      { ...close('C', 1, 8), importance: 0.7 },
    ];
    const s = selectMemories(mem, 5).map((m) => m.content);
    expect(s).toEqual(['new reflection', 'r3', 'r2', 'Closed A', 'Closed C']);
    expect(selectMemories([], 5)).toEqual([]);
  });
});

describe('recallMemory', () => {
  const mem: MemoryEntry[] = Array.from({ length: 30 }, (_, i) => ({ ...close(i % 2 ? 'NOVA' : 'VOLT', i, i) }));

  it('returns newest first, filtered by kind and subject, capped at 20', () => {
    expect(recallMemory(mem, {})).toHaveLength(10);
    expect(recallMemory(mem, { limit: 99 })).toHaveLength(20);
    const nova = recallMemory(mem, { subject: 'nova', limit: 3 });
    expect(nova.map((m) => m.tickCountAt)).toEqual([29, 27, 25]);
    expect(recallMemory(mem, { kind: 'reflective' })).toEqual([]);
  });
});
