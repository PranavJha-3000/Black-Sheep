/**
 * Black Sheep - core domain types.
 *
 * Pure TypeScript only: no React, no DOM, no store imports.
 */

export type Ticker = string;

export type Direction = 'long' | 'short';

export type Sector = 'tech' | 'auto' | 'space' | 'finance' | 'consumer' | 'biotech';

export interface Company {
  ticker: Ticker;
  name: string;
  sector: Sector;
  price: number;
  previousClose: number;
  volatility: number;
  beta: number;
  rateSensitivity: number;
  /**
   * Average daily volume proxy in dollars. Denominated in dollars (not a 0-1
   * score) because the square-root impact model divides trade size by ADV to
   * get a dimensionless participation rate — dollar/dollar cancels cleanly.
   * Low liquidity = same dollar trade eats more of the order book and moves
   * price further. Seeded inversely to volatility: HELX biotech is thinnest,
   * APEX BANK is deepest.
   */
  liquidity: number;
}

export interface Position {
  id: string;
  ticker: Ticker;
  direction: Direction;
  quantity: number;
  entryPrice: number;
  entryTimestamp: number;
  marginReserved: number;
}

export interface MarketState {
  companies: Record<Ticker, Company>;
  tickCount: number;
  timestamp: number;
  /**
   * Rolling log of recent trades (player + rival) used to compute net flow.
   * Capped at FLOW_CAP entries in applyTrade. The LLM rival reads this to
   * detect crowded trades.
   */
  recentFlow: FlowRecord[];
}

export type MarketEventType = 'earnings' | 'macro' | 'sector' | 'company';

export interface MarketEvent {
  id: string;
  type: MarketEventType;
  ticker?: Ticker;
  sector?: Sector;
  headline: string;
  priceImpactPercent: number;
  timestamp: number;
}

/**
 * One entry in MarketState.recentFlow. Records a single trade so getNetFlow can
 * sum signed flow per ticker over a lookback window. direction 'buy' = buying
 * pressure (pushes price up), 'sell' = selling pressure (pushes price down).
 */
export interface FlowRecord {
  ticker: Ticker;
  direction: 'buy' | 'sell';
  dollarAmount: number;
  timestamp: number;
}
