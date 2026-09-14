import type { Position, Ticker } from '@black-sheep/engine/types';
import type { RivalLastDecision } from '@black-sheep/engine/rival';
import type { AwayPositionRow } from '@black-sheep/engine/away';
import { INITIAL_MARGIN_RATE } from '@black-sheep/engine/portfolio';

/** Prisma Position row shape (open or closed). Shared by rooms + away. */
export interface PositionRowLike {
  id: number;
  ticker: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  entryTimestamp: Date;
  closedAt: Date | null;
  exitPrice: number | null;
}

export function directionOf(value: string): 'long' | 'short' {
  return value === 'short' ? 'short' : 'long';
}

/** Map a persisted row to an engine Position (margin reconstructed). */
export function enginePosition(row: PositionRowLike): Position {
  const direction = directionOf(row.direction);
  return {
    id: `db-${row.id}`,
    ticker: row.ticker as Ticker,
    direction,
    quantity: row.quantity,
    entryPrice: row.entryPrice,
    entryTimestamp: row.entryTimestamp.getTime(),
    marginReserved:
      direction === 'short' ? INITIAL_MARGIN_RATE * row.quantity * row.entryPrice : 0,
  };
}

/** Map rows to the away-math input, stamping realized P&L on closed rows. */
export function awayRowsOf(rows: PositionRowLike[]): AwayPositionRow[] {
  return rows.map((p) => {
    const direction = directionOf(p.direction);
    const base: AwayPositionRow = {
      ticker: p.ticker as Ticker,
      direction,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
    };
    if (p.closedAt && p.exitPrice !== null && p.exitPrice !== undefined) {
      const raw = (p.exitPrice - p.entryPrice) * p.quantity;
      base.realizedPnl = direction === 'long' ? raw : -raw;
    }
    return base;
  });
}

/** Map a RivalDecisionLog row to the detector input (telemetry preserved). */
export function awayDecisionOf(row: {
  action: string;
  ticker: string | null;
  reasoning: string;
  confidence: number | null;
  fillPrice: number | null;
  realizedPnL: number | null;
  tickCountAt: number | null;
  timestamp: Date;
}): RivalLastDecision & { atMs: number } {
  const action =
    row.action === 'buy' || row.action === 'short' || row.action === 'close'
      ? row.action
      : 'hold';
  return {
    action,
    ticker: (row.ticker ?? undefined) as Ticker | undefined,
    reasoning: row.reasoning,
    confidence: row.confidence ?? 0.7,
    timestamp: row.tickCountAt ?? 0,
    fillPrice: row.fillPrice ?? undefined,
    realizedPnL: row.realizedPnL ?? undefined,
    atMs: row.timestamp.getTime(),
  };
}

/** Parse a MarketTick snapshotJson into then-prices + then-tick. */
export function parseSnapshot(json: string): {
  prices: Record<string, number>;
  tickCount: number;
} {
  const fallback = { prices: {}, tickCount: 0 };
  try {
    const parsed = JSON.parse(json) as {
      market?: { companies?: Record<string, { price?: number }>; tickCount?: number };
    };
    const companies = parsed.market?.companies ?? {};
    const prices: Record<string, number> = {};
    for (const [t, c] of Object.entries(companies)) {
      if (typeof c?.price === 'number') prices[t] = c.price;
    }
    const tickCount =
      typeof parsed.market?.tickCount === 'number' ? parsed.market.tickCount : 0;
    return { prices, tickCount };
  } catch {
    return fallback;
  }
}
