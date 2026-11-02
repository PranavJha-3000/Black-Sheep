/*
 * Black Sheep - agent memory rules (VISION §7).
 *
 * PURE functions that turn what happened to a fund into memory entries:
 *   - episodic: its own filled trades, closes (with realized outcome) and liquidation;
 *   - reflective: a deterministic summary of recent closed trades;
 *   - relationship: other funds' PUBLIC actions against or alongside its book.
 * The server persists entries and shows them back to the fund's model. This is
 * persistent memory, not learning: nothing here changes a model or a policy.
 */

import {
  MEMORY_RECALL_DEFAULT,
  MEMORY_RECALL_MAX,
  MEMORY_REFLECT_EVERY_CLOSES,
} from '../../../config/game';
import type { RivalFund, RivalLastDecision } from './rival';
import type { Position } from './types';

export type MemoryKind = 'episodic' | 'reflective' | 'relationship';

export interface MemoryEntry {
  kind: MemoryKind;
  tickCountAt: number;
  /** Ticker for episodes, the other fund's name for relationship notes, null for reflections. */
  subject: string | null;
  content: string;
  /** 0..1 — how much this should weigh when choosing what to show the model. */
  importance: number;
  /** Realized P&L of a closing trade; null otherwise. */
  outcomeUsd: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const usd = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;
const signedUsd = (v: number) => `${v < 0 ? '-' : '+'}${usd(v)}`;
const thesis = (r: string) => (r.length > 160 ? `${r.slice(0, 157)}...` : r);

/**
 * The fund's own decision, if it filled, as an episode. `source` is who made
 * it (D-025); anything but the model is prefixed so the model never reads a
 * fallback policy's trade as its own call.
 */
export function episodeFromDecision(after: RivalFund, nav: number, tick: number, source = 'llm'): MemoryEntry | null {
  const d = after.lastDecision;
  if (!d || !d.ticker || d.fillPrice === undefined) return null;
  const by = source === 'llm' ? '' : `(${source}) `;
  if (d.action === 'buy' || d.action === 'short') {
    const size = d.dollarAmount ?? 0;
    return {
      kind: 'episodic',
      tickCountAt: tick,
      subject: d.ticker,
      content: `${by}Opened ${d.action === 'buy' ? 'LONG' : 'SHORT'} ${d.ticker} ${usd(size)} at $${d.fillPrice.toFixed(2)} — ${thesis(d.reasoning)}`,
      importance: clamp01(Math.max(0.1, (size / Math.max(nav, 1)) * 3)),
      outcomeUsd: null,
    };
  }
  if (d.action === 'close' && d.realizedPnL !== undefined) {
    return {
      kind: 'episodic',
      tickCountAt: tick,
      subject: d.ticker,
      content: `${by}Closed ${d.ticker} for ${signedUsd(d.realizedPnL)} — ${thesis(d.reasoning)}`,
      importance: clamp01(0.3 + (Math.abs(d.realizedPnL) / Math.max(nav, 1)) * 10),
      outcomeUsd: d.realizedPnL,
    };
  }
  return null;
}

export function episodeFromLiquidation(cause: string, tick: number): MemoryEntry {
  return { kind: 'episodic', tickCountAt: tick, subject: null, content: `LIQUIDATED — ${cause}`, importance: 1, outcomeUsd: null };
}

/** Summarise the closed trades since the last reflection; null until enough have accumulated. */
export function reflect(memory: MemoryEntry[], tick: number): MemoryEntry | null {
  let start = 0;
  for (let i = memory.length - 1; i >= 0; i--) {
    if (memory[i].kind === 'reflective') {
      start = i + 1;
      break;
    }
  }
  const closes = memory.slice(start).filter((m) => m.kind === 'episodic' && m.outcomeUsd !== null);
  if (closes.length < MEMORY_REFLECT_EVERY_CLOSES) return null;

  const wins = closes.filter((c) => (c.outcomeUsd ?? 0) > 0).length;
  const losses = closes.length - wins;
  const net = closes.reduce((s, c) => s + (c.outcomeUsd ?? 0), 0);
  const byTicker = new Map<string, { net: number; losses: number }>();
  for (const c of closes) {
    const k = c.subject ?? '?';
    const t = byTicker.get(k) ?? { net: 0, losses: 0 };
    t.net += c.outcomeUsd ?? 0;
    if ((c.outcomeUsd ?? 0) <= 0) t.losses++;
    byTicker.set(k, t);
  }
  const ranked = [...byTicker.entries()].sort((a, b) => b[1].net - a[1].net);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const repeated = ranked.filter(([, t]) => t.losses >= 2).map(([k]) => k);

  let observation: string;
  if (repeated.length > 0) observation = `Repeated losses on ${repeated.join(', ')} — reassess before trading it again.`;
  else if (wins / closes.length < 0.4) observation = 'Most recent calls lost — demand stronger confirmation before opening.';
  else if (net < 0) observation = 'Losses outweigh wins — cut losing positions sooner.';
  else observation = 'Recent approach is paying — keep the same sizing discipline.';

  return {
    kind: 'reflective',
    tickCountAt: tick,
    subject: null,
    content:
      `Last ${closes.length} closed trades: ${wins} win${wins === 1 ? '' : 's'}, ${losses} loss${losses === 1 ? '' : 'es'}, ` +
      `net ${signedUsd(net)}; best ${best[0]}, worst ${worst[0]}. ${observation}`,
    importance: 0.8,
    outcomeUsd: null,
  };
}

/**
 * Another fund's public, filled open on a ticker this fund holds. Uses only
 * the other fund's action and ticker — never its size or book (D-017).
 */
export function relationshipNote(
  selfPositions: Position[],
  otherName: string,
  other: RivalLastDecision,
  tick: number,
): MemoryEntry | null {
  if ((other.action !== 'buy' && other.action !== 'short') || !other.ticker || other.fillPrice === undefined) return null;
  const held = selfPositions.find((p) => p.ticker === other.ticker);
  if (!held) return null;
  const otherSide = other.action === 'buy' ? 'long' : 'short';
  const against = otherSide !== held.direction;
  return {
    kind: 'relationship',
    tickCountAt: tick,
    subject: otherName,
    content: against
      ? `${otherName} ${other.action === 'buy' ? 'bought' : 'shorted'} ${other.ticker} while I was ${held.direction}.`
      : `${otherName} also went ${otherSide} ${other.ticker} — crowded trade.`,
    importance: against ? 0.6 : 0.3,
    outcomeUsd: null,
  };
}

/** What the model sees: latest reflection, two latest relationship notes, then the weightiest recent episodes. */
export function selectMemories(memory: MemoryEntry[], n: number): MemoryEntry[] {
  const newestFirst = [...memory].reverse();
  const out: MemoryEntry[] = [];
  const reflection = newestFirst.find((m) => m.kind === 'reflective');
  if (reflection) out.push(reflection);
  out.push(...newestFirst.filter((m) => m.kind === 'relationship').slice(0, 2));
  const episodes = newestFirst
    .filter((m) => m.kind === 'episodic')
    .slice(0, 20)
    .sort((a, b) => b.importance - a.importance || b.tickCountAt - a.tickCountAt);
  out.push(...episodes);
  return out.slice(0, n);
}

export interface RecallQuery {
  kind?: MemoryKind;
  subject?: string;
  limit?: number;
}

/** recall_memory: newest first, optionally filtered, capped. */
export function recallMemory(memory: MemoryEntry[], q: RecallQuery): MemoryEntry[] {
  const limit = Math.max(1, Math.min(MEMORY_RECALL_MAX, Math.floor(q.limit ?? MEMORY_RECALL_DEFAULT)));
  const subject = q.subject?.toUpperCase();
  return [...memory]
    .reverse()
    .filter((m) => (!q.kind || m.kind === q.kind) && (!subject || m.subject?.toUpperCase() === subject))
    .slice(0, limit);
}
