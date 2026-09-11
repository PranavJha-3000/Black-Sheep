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
