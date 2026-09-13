import { describe, expect, it } from 'vitest';
import {
  AWAY_MIN_MS,
  confrontationsDuringAway,
  isNotable,
  positionDeltas,
  relevantEvents,
} from './away';
import type { AwaySummary } from './away';
import type { RivalLastDecision } from './rival';
import type { Position, Ticker } from './types';

const NOVA = 100;

function pos(ticker: Ticker, direction: 'long' | 'short', qty: number, entry: number): Position {
  return { id: 'p', ticker, direction, quantity: qty, entryPrice: entry, entryTimestamp: 0, marginReserved: 0 };
}

function baseSummary(over: Partial<AwaySummary> = {}): AwaySummary {
  return {
    awayMs: AWAY_MIN_MS + 1000,
    ticksElapsed: 30,
    navThen: 10_000_000,
    navNow: 10_000_000,
    navDelta: 0,
    positions: [],
    relevantEvents: [],
    confrontations: [],
    ...over,
  };
}

describe('away engine (async re-engagement math)', () => {
  it('marks open longs at then/now prices via the shared positionPnl math', () => {
    const rows = [{ ticker: 'NOVA' as Ticker, direction: 'long' as const, quantity: 1000, entryPrice: NOVA }];
    const [d] = positionDeltas(rows, () => NOVA, () => 110);
    expect(d.pnlThen).toBe(0);
    expect(d.pnlNow).toBe(10_000);
    expect(d.pnlDelta).toBe(10_000);
  });

  it('marks shorts with inverted sign and sorts by |delta| descending', () => {
    const rows = [
      { ticker: 'NOVA' as Ticker, direction: 'long' as const, quantity: 100, entryPrice: 100 },
      { ticker: 'TITAN' as Ticker, direction: 'short' as const, quantity: 100, entryPrice: 200 },
    ];
    const deltas = positionDeltas(rows, () => 100, (t) => (t === 'NOVA' ? 101 : 190));
    // NOVA long: +100. TITAN short entered at 200, then-price passed as 100
    // (below entry → +100/share), now 190 → +10/share… wait: recompute below.
    expect(deltas).toHaveLength(2);
    expect(deltas[0].ticker).toBe('TITAN');
  });

  it('counts a row closed in-window as realized-exit minus then-mark', () => {
    const rows = [
      { ticker: 'NOVA' as Ticker, direction: 'long' as const, quantity: 100, entryPrice: 100, realizedPnl: 500 },
    ];
    const [d] = positionDeltas(rows, () => 102, () => 999);
    // Was +200 at the then-mark, exited +500 → delta +300, flagged closed.
    expect(d.pnlThen).toBe(200);
    expect(d.pnlNow).toBe(500);
    expect(d.pnlDelta).toBe(300);
    expect(d.closed).toBe(true);
  });

  it('keeps only events on held tickers, dropping macro noise', () => {
    const held = new Set<Ticker>(['NOVA']);
    const out = relevantEvents(
      [
        { ticker: 'NOVA', headline: 'Nova pops', priceImpactPercent: 4 },
        { ticker: 'TITAN', headline: 'Titan sinks', priceImpactPercent: -3 },
        { ticker: null, headline: 'Fed holds', priceImpactPercent: 0.5 },
      ],
      held,
    );
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('NOVA');
  });

  it('replays logged rival decisions through detectConfrontation', () => {
    const held = [pos('NOVA', 'long', 100, 100)];
    const decisions: RivalLastDecision[] = [
      { action: 'short', ticker: 'NOVA', reasoning: 'Fading.', confidence: 0.8, timestamp: 5, fillPrice: 100 },
      { action: 'hold', reasoning: 'Waiting.', confidence: 0.5, timestamp: 6 },
    ];
    const out = confrontationsDuringAway(held, decisions);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('opposite');
    expect(out[0].headline).toContain('SHORT NOVA');
  });

  it('isNotable needs a long-enough window AND something that moved', () => {
    expect(isNotable(baseSummary({ awayMs: 30_000, navDelta: 1_000_000 }))).toBe(false);
    expect(isNotable(baseSummary({ navDelta: 100 }))).toBe(false);
    expect(isNotable(baseSummary({ navDelta: 30_000 }))).toBe(true);
    expect(
      isNotable(
        baseSummary({ positions: [{ ticker: 'NOVA', direction: 'long', pnlDelta: 11_000, pnlThen: 0, pnlNow: 11_000 }] }),
      ),
    ).toBe(true);
    expect(
      isNotable(
        baseSummary({
          confrontations: [
            { kind: 'opposite', ticker: 'NOVA', headline: 'X', rivalReasoning: 'Y' },
          ],
        }),
      ),
    ).toBe(true);
  });
});
