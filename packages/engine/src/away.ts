import type { Position, Ticker } from './types';
import { positionPnl } from './portfolio';
import { detectConfrontation } from './rival';
import type { ConfrontationEvent, RivalLastDecision } from './rival';

/*
 * Black Sheep - async re-engagement ("while you were away") math.
 *
 * Pure TypeScript, zero UI/DB deps. The server queries the persistence layer
 * (MarketTick snapshots, MarketEventLog, RivalDecisionLog, Position rows),
 * reduces them into the small input shapes below, and these functions compute
 * the away summary deterministically. The client renders it and gates it with
 * isNotable — same function, both sides, no duplicated rules.
 */

/** One ticker's P&L excursion while the player was away. */
export interface AwayPositionDelta {
  ticker: Ticker;
  direction: 'long' | 'short';
  /** Signed P&L change in dollars over the window (then → now). */
  pnlDelta: number;
  /** P&L at the window start (reconstructed from the then-snapshot). */
  pnlThen: number;
  /** P&L at the window end (marked at current prices). */
  pnlNow: number;
  /** True when the player no longer holds this name. */
  closed?: boolean;
}

/** A market event that touched something the player actually held. */
export interface AwayRelevantEvent {
  ticker: Ticker | null;
  headline: string;
  priceImpactPercent: number;
}

/** A rival decision that was confrontational against the away book. */
export interface AwayConfrontation {
  kind: 'opposite' | 'rival_win';
  ticker: Ticker;
  headline: string;
  rivalReasoning: string;
  rivalGain?: number;
  /** Wall-clock ms when the rival decision logged (for "while you were away" copy). */
  atMs?: number;
}

/** Everything the "WHILE YOU WERE AWAY" screen renders. */
export interface AwaySummary {
  /** Wall-clock ms the player was gone. */
  awayMs: number;
  /** Engine ticks that elapsed in the room while away. */
  ticksElapsed: number;
  /** NAV reconstructed at the window start. */
  navThen: number;
  /** NAV at the window end. */
  navNow: number;
  /** navNow - navThen (signed dollars). */
  navDelta: number;
  /** Per-ticker deltas, sorted by |pnlDelta| descending. */
  positions: AwayPositionDelta[];
  /** Events that hit held tickers only — never the full firehose. */
  relevantEvents: AwayRelevantEvent[];
  /** Confrontations detected against the away book, oldest first. */
  confrontations: AwayConfrontation[];
}

/**
 * Display gate: only show the takeover when the window was meaningfully long
 * AND something actually happened. A bare refresh (seconds, nothing moved)
 * must never train players to dismiss this screen.
 *
 * Tunables live here, in one place, so the threshold is a one-line change:
 * AWAY_MIN_MS (window floor), NAV_NOTABLE_DOLLARS (NAV moved), POS_NOTABLE
 * (one name moved). A confrontation is notable on its own — that is the
 * highest-leverage moment this feature exists to surface.
 */
export const AWAY_MIN_MS = 2 * 60 * 1000;
export const AWAY_NAV_NOTABLE_DOLLARS = 25_000;
export const AWAY_POS_NOTABLE_DOLLARS = 10_000;

export function isNotable(summary: AwaySummary): boolean {
  if (summary.awayMs < AWAY_MIN_MS) return false;
  if (summary.confrontations.length > 0) return true;
  if (Math.abs(summary.navDelta) >= AWAY_NAV_NOTABLE_DOLLARS) return true;
  return summary.positions.some((p) => Math.abs(p.pnlDelta) >= AWAY_POS_NOTABLE_DOLLARS);
}



/** Minimal row shape the server feeds in (DB Position, mapped, open or closed). */
export interface AwayPositionRow {
  ticker: Ticker;
  direction: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  /** Realized P&L if the row was closed inside the window. */
  realizedPnl?: number;
}

/**
 * Per-position P&L excursion over the window.
 *
 * Open rows are marked at then/now prices via positionPnl (the shared engine
 * math — no duplicate formula). Rows closed inside the window contribute
 * their realized P&L as the delta (pnlThen → realized exit).
 */
export function positionDeltas(
  rows: AwayPositionRow[],
  priceThen: (ticker: Ticker) => number,
  priceNow: (ticker: Ticker) => number,
): AwayPositionDelta[] {
  const deltas: AwayPositionDelta[] = [];
  for (const row of rows) {
    if (row.quantity <= 0) continue;
    const pos: Position = {
      id: 'away',
      ticker: row.ticker,
      direction: row.direction,
      quantity: row.quantity,
      entryPrice: row.entryPrice,
      entryTimestamp: 0,
      marginReserved: 0,
    };
    const then = priceThen(row.ticker);
    const now = priceNow(row.ticker);
    if (row.realizedPnl !== undefined) {
      const pnlThen = then > 0 ? positionPnl(pos, then) : 0;
      deltas.push({
        ticker: row.ticker,
        direction: row.direction,
        pnlDelta: row.realizedPnl - pnlThen,
        pnlThen,
        pnlNow: row.realizedPnl,
        closed: true,
      });
      continue;
    }
    if (then <= 0 || now <= 0) continue;
    const pnlThen = positionPnl(pos, then);
    const pnlNow = positionPnl(pos, now);
    deltas.push({
      ticker: row.ticker,
      direction: row.direction,
      pnlDelta: pnlNow - pnlThen,
      pnlThen,
      pnlNow,
    });
  }
  deltas.sort((a, b) => Math.abs(b.pnlDelta) - Math.abs(a.pnlDelta));
  return deltas;
}

/**
 * Keep only the events that touched a held ticker. Ticker-less (macro)
 * events are noise for a player holding nothing it names — drop them.
 */
export function relevantEvents(
  events: Array<{ ticker: Ticker | null; headline: string; priceImpactPercent: number }>,
  held: ReadonlySet<Ticker>,
): AwayRelevantEvent[] {
  return events
    .filter((e) => e.ticker !== null && held.has(e.ticker))
    .map((e) => ({ ticker: e.ticker, headline: e.headline, priceImpactPercent: e.priceImpactPercent }));
}

/**
 * Replay each logged rival decision against the away book through the SAME
 * detectConfrontation the live terminal uses. `heldPositions` is the player's
 * book as it was during the window — for 'opposite' a name held at any point
 * in the window counts; for 'rival_win' the same positionPnl-at-close-price
 * check applies. Returns confrontations oldest-first.
 */
export function confrontationsDuringAway(
  heldPositions: Position[],
  decisions: Array<RivalLastDecision & { atMs?: number }>,
): AwayConfrontation[] {
  const out: AwayConfrontation[] = [];
  for (const d of decisions) {
    if (!d.ticker) continue;
    const evt: ConfrontationEvent | null = detectConfrontation(heldPositions, d);
    if (evt) {
      out.push({
        kind: evt.kind,
        ticker: evt.ticker,
        headline: evt.headline,
        rivalReasoning: evt.rivalReasoning,
        rivalGain: evt.rivalGain,
        atMs: d.atMs,
      });
    }
  }
  return out;
}
