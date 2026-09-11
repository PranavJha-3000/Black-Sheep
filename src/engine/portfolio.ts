/*
 * Black Sheep - portfolio/account logic.
 * Pure TypeScript. No UI dependencies (see market.ts for the purity rule).
 *
 * This is the financial core of the game. Every function here is pure:
 * it takes a Fund and returns a new Fund, never mutating the input.
 * Every later feature (UI, store, server) depends on this being correct.
 */

import type { Direction, MarketState, Position, Ticker } from './types';

// ---------------------------------------------------------------------------
// Margin constants
// ---------------------------------------------------------------------------

/**
 * Initial margin rate for short positions.
 * When you open a short, you must reserve this fraction of the position's
 * notional value as margin. This cash is locked and can't be spent.
 * 50% matches the real-world Reg-T initial margin requirement.
 */
const INITIAL_MARGIN_RATE = 0.5;

/**
 * Maintenance margin rate for short positions.
 * The minimum equity that must remain in a short position's margin account,
 * expressed as a fraction of the CURRENT notional value. If the margin
 * account falls below this, the position is flagged for liquidation.
 * 25% is a realistic maintenance margin requirement.
 */
const MAINTENANCE_MARGIN_RATE = 0.25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A hedge fund's complete state.
 *
 * - cash: total cash balance (includes proceeds from short sales)
 * - positions: all open positions
 * - realizedPnL: total profit/loss from closed positions
 * - startingCapital: initial capital (for computing returns)
 * - history: NAV snapshots for charting
 */
export interface Fund {
  cash: number;
  positions: Position[];
  realizedPnL: number;
  startingCapital: number;
  history: { timestamp: number; nav: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a new fund with the given starting capital. */
export function createFund(startingCapital: number, timestamp: number = 0): Fund {
  return {
    cash: startingCapital,
    positions: [],
    realizedPnL: 0,
    startingCapital,
    history: [{ timestamp, nav: startingCapital }],
  };
}

/**
 * Total margin reserved across all open positions.
 * This is cash that's locked up and can't be used for new trades.
 */
export function totalMarginReserved(fund: Fund): number {
  return fund.positions.reduce((sum, p) => sum + p.marginReserved, 0);
}

/**
 * Cash that's available for new trades.
 * Available cash = total cash - margin reserved for existing positions.
 */
export function availableCash(fund: Fund): number {
  return fund.cash - totalMarginReserved(fund);
}

/** Generate a unique ID for a new position. */
function generatePositionId(
  fund: Fund,
  ticker: string,
  direction: Direction,
): string {
  return `${ticker}-${direction}-${fund.positions.length}-${Date.now()}`;
}

/**
 * Unrealized P&L for a single position, in dollars.
 * Long: (currentPrice - entryPrice) * quantity
 * Short: (entryPrice - currentPrice) * quantity
 */
export function positionPnl(pos: Position, currentPrice: number): number {
  const raw = (currentPrice - pos.entryPrice) * pos.quantity;
  return pos.direction === 'long' ? raw : -raw;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Open a new position.
 *
 * LONG: Spend dollarAmount to buy shares.
 *   - Cash decreases by dollarAmount
 *   - No margin required (you own the shares outright)
 *   - Check: available cash >= dollarAmount
 *
 * SHORT: Borrow and sell shares, receiving dollarAmount in proceeds.
 *   - Cash increases by dollarAmount (the proceeds)
 *   - Margin (50% of dollarAmount) is reserved from available cash
 *   - Check: available cash >= margin required
 *
 * Returns the fund unchanged if validation fails.
 */
export function openPosition(
  fund: Fund,
  ticker: Ticker,
  direction: Direction,
  dollarAmount: number,
  currentPrice: number,
): Fund {
  if (currentPrice <= 0 || dollarAmount <= 0) return fund;
  if (!Number.isFinite(currentPrice) || !Number.isFinite(dollarAmount)) return fund;

  const quantity = dollarAmount / currentPrice;
  const marginRequired = direction === 'short' ? INITIAL_MARGIN_RATE * dollarAmount : 0;

  const avail = availableCash(fund);
  if (direction === 'long' && avail < dollarAmount) return fund;
  if (direction === 'short' && avail < marginRequired) return fund;

  const position: Position = {
    id: generatePositionId(fund, ticker, direction),
    ticker,
    direction,
    quantity,
    entryPrice: currentPrice,
    entryTimestamp: Date.now(),
    marginReserved: marginRequired,
  };

  return {
    ...fund,
    cash: direction === 'long' ? fund.cash - dollarAmount : fund.cash + dollarAmount,
    positions: [...fund.positions, position],
  };
}

/**
 * Close a position by ID.
 *
 * LONG: Sell the shares.
 *   - Cash increases by currentPrice * quantity
 *   - P&L = (currentPrice - entryPrice) * quantity
 *
 * SHORT: Buy back the shares.
 *   - Cash decreases by currentPrice * quantity
 *   - P&L = (entryPrice - currentPrice) * quantity
 *   - Margin is released automatically (position removed from array)
 *
 * Returns the fund unchanged if the position ID doesn't exist.
 */
export function closePosition(
  fund: Fund,
  positionId: string,
  currentPrice: number,
): Fund {
  const position = fund.positions.find((p) => p.id === positionId);
  if (!position) return fund;
  if (currentPrice <= 0 || !Number.isFinite(currentPrice)) return fund;

  const pnl = positionPnl(position, currentPrice);

  const cashFromClosing = position.direction === 'long'
    ? currentPrice * position.quantity   // sell shares
    : -currentPrice * position.quantity; // buy back shares

  return {
    ...fund,
    cash: fund.cash + cashFromClosing,
    realizedPnL: fund.realizedPnL + pnl,
    positions: fund.positions.filter((p) => p.id !== positionId),
  };
}

/**
 * Mark all positions to market. Pure calculation - does NOT mutate the fund.
 *
 * NAV = cash + sum of position market values
 *   - Long position market value = currentPrice * quantity (asset)
 *   - Short position market value = -(currentPrice * quantity) (liability)
 *
 * Equivalently: NAV = startingCapital + realizedPnL + unrealizedPnL
 */
export function markToMarket(
  fund: Fund,
  market: MarketState,
): { fund: Fund; unrealizedPnL: number; nav: number } {
  let unrealizedPnL = 0;
  let marketValue = 0;

  for (const pos of fund.positions) {
    const currentPrice = market.companies[pos.ticker]?.price ?? 0;
    unrealizedPnL += positionPnl(pos, currentPrice);
    marketValue += pos.direction === 'long'
      ? currentPrice * pos.quantity
      : -(currentPrice * pos.quantity);
  }

  const nav = fund.cash + marketValue;
  return { fund, unrealizedPnL, nav };
}

/**
 * Compute the fund's exposure.
 *
 * - grossExposure: sum of absolute position values (total market exposure)
 * - netExposure: longs minus shorts (directional bias)
 * - exposureByTicker: net exposure for each ticker
 */
export function getExposure(
  fund: Fund,
  market: MarketState,
): {
  grossExposure: number;
  netExposure: number;
  exposureByTicker: Record<Ticker, number>;
} {
  let grossExposure = 0;
  let netExposure = 0;
  const exposureByTicker: Record<Ticker, number> = {};

  for (const pos of fund.positions) {
    const currentPrice = market.companies[pos.ticker]?.price ?? 0;
    const value = pos.direction === 'long'
      ? currentPrice * pos.quantity
      : -(currentPrice * pos.quantity);

    grossExposure += Math.abs(value);
    netExposure += value;
    exposureByTicker[pos.ticker] = (exposureByTicker[pos.ticker] ?? 0) + value;
  }

  return { grossExposure, netExposure, exposureByTicker };
}

/**
 * Check if the fund is at liquidation risk.
 *
 * MAINTENANCE MARGIN CONCEPT (for a junior engineer):
 * -------------------------------------------------
 * When you short a stock, you borrow shares and sell them. You receive cash,
 * but you owe the shares back later. To make sure you can cover this
 * obligation, you must post "margin" - collateral that the broker holds.
 *
 * The INITIAL margin (50%) is what you post when opening the short.
 * The MAINTENANCE margin (25%) is the minimum equity that must remain in
 * your margin account. If the stock price rises, your short loses money,
 * and your margin account shrinks. If it falls below the maintenance margin,
 * the broker issues a margin call - you must deposit more cash or the
 * position is liquidated (force-closed) to protect the broker.
 *
 * For each short position:
 *   marginAccount = marginReserved + unrealizedPnL
 *   maintenanceMargin = MAINTENANCE_MARGIN_RATE * currentPrice * quantity
 *
 * At the fund level:
 *   totalMarginAccount = sum of marginAccount for all shorts
 *   totalMaintenanceMargin = sum of maintenanceMargin for all shorts
 *
 * atRisk = totalMarginAccount < totalMaintenanceMargin
 * marginUsedPercent = (totalMaintenanceMargin / totalMarginAccount) * 100
 *   (values > 100% mean the fund is at risk)
 */
export function checkLiquidation(
  fund: Fund,
  market: MarketState,
): { atRisk: boolean; marginUsedPercent: number; message: string } {
  let totalMarginAccount = 0;
  let totalMaintenanceMargin = 0;

  for (const pos of fund.positions) {
    if (pos.direction !== 'short') continue;

    const currentPrice = market.companies[pos.ticker]?.price ?? 0;
    const unrealizedPnL = positionPnl(pos, currentPrice);

    // Margin account = initial margin posted + unrealized P&L
    // As price rises, unrealized P&L becomes negative, shrinking the account
    const marginAccount = pos.marginReserved + unrealizedPnL;

    // Maintenance margin is based on CURRENT notional (not entry notional)
    // because the broker cares about current exposure
    const maintenanceMargin = MAINTENANCE_MARGIN_RATE * currentPrice * pos.quantity;

    totalMarginAccount += marginAccount;
    totalMaintenanceMargin += maintenanceMargin;
  }

  if (totalMaintenanceMargin === 0) {
    return {
      atRisk: false,
      marginUsedPercent: 0,
      message: 'No short positions - no margin risk.',
    };
  }

  const marginUsedPercent = totalMarginAccount > 0
    ? (totalMaintenanceMargin / totalMarginAccount) * 100
    : Infinity;
  const atRisk = totalMarginAccount < totalMaintenanceMargin;

  const message = atRisk
    ? `LIQUIDATION RISK: Margin equity $${totalMarginAccount.toFixed(2)} below maintenance requirement $${totalMaintenanceMargin.toFixed(2)}. Deposit cash or close positions.`
    : `Margin healthy: $${totalMarginAccount.toFixed(2)} equity vs $${totalMaintenanceMargin.toFixed(2)} maintenance required.`;

  return { atRisk, marginUsedPercent, message };
}


/**
 * Force-close ALL open positions at current market price.
 * Used when the fund is liquidated. Iterates positions and closes each one,
 * returning a fund with zero positions and all P&L realized.
 */
export function liquidateFund(fund: Fund, market: MarketState): Fund {
  let result = fund;
  // Iterate over a snapshot since closePosition returns a new fund
  const positions = [...fund.positions];
  for (const pos of positions) {
    const price = market.companies[pos.ticker]?.price ?? 0;
    if (price > 0) {
      result = closePosition(result, pos.id, price);
    }
  }
  return result;
}

/**
 * Derive a human-readable "cause of death" from the fund's positions.
 * Analyzes actual exposure concentration:
 *   - If one ticker dominates (>55% of NAV), it's excessive concentration.
 *   - Otherwise, it's excessive leverage across many positions.
 */
export function deriveCauseOfDeath(fund: Fund, market: MarketState): string {
  if (fund.positions.length === 0) return 'Excessive leverage';

  const nav = markToMarket(fund, market).nav;
  if (nav <= 0) return 'Excessive leverage';

  // Aggregate absolute exposure by ticker
  const byTicker: Record<Ticker, number> = {};
  for (const pos of fund.positions) {
    const price = market.companies[pos.ticker]?.price ?? 0;
    const notional = price * pos.quantity;
    byTicker[pos.ticker] = (byTicker[pos.ticker] ?? 0) + Math.abs(notional);
  }

  // Find the largest single-ticker exposure
  let maxTicker: Ticker = '';
  let maxExposure = 0;
  for (const [ticker, exposure] of Object.entries(byTicker)) {
    if (exposure > maxExposure) {
      maxExposure = exposure;
      maxTicker = ticker;
    }
  }

  // If one ticker is more than 55% of NAV, call it concentration
  if (maxTicker && maxExposure / nav > 0.55) {
    return `Excessive concentration in ${maxTicker}`;
  }
  return 'Excessive leverage';
}

/**
 * Peak NAV reached over the fund's lifetime, from its history.
 */
export function peakNav(fund: Fund): number {
  if (fund.history.length === 0) return fund.startingCapital;
  return fund.history.reduce((peak, entry) => Math.max(peak, entry.nav), fund.startingCapital);
}