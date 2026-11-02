/*
 * Black Sheep — central tuning parameters (design doc §11).
 *
 * Single source of truth for every gameplay tuning constant. The shared pure
 * engine (packages/engine) and the server/client all import from here, so each
 * value lives in exactly one place. This file MUST stay dependency-free (no
 * imports, no I/O) so the pure engine can consume it without pulling in
 * express/prisma/react or any runtime.
 *
 * These are the current shipped numbers, moved verbatim from their former
 * inline locations. Tune here and ONLY here — never re-hardcode a value in a
 * module.
 */

// --- Fund / capital ---
/** Starting cash for every player and rival fund. */
export const STARTING_CAPITAL = 10_000_000;

// --- World loop (server) ---
/** Server world tick interval, in milliseconds. */
export const TICK_INTERVAL_MS = 5_000;
/** Full market snapshots every N engine ticks (periodic, NOT every tick). */
export const SNAPSHOT_EVERY_TICKS = 3;
/** In-memory cap on World.events (most-recent-first); older entries are dropped. */
export const EVENT_BUFFER = 60;

// --- Market model (packages/engine/src/market.ts) ---
/** Mean-reversion strength per tick (fraction of the gap to previousClose closed). */
export const MEAN_REVERSION = 0.02;
/**
 * Calibration constant for the square-root impact model. Higher = trades move
 * price more for a given participation rate. Tuned so a $5M trade on thin HELX
 * (~$40M ADV) moves ~3.5%; the same $5M on deep APXB (~$1.2B ADV) moves ~0.65%
 * — a 5.5x liquidity spread that is visible on the chart.
 */
export const IMPACT_COEFF = 0.1;
/**
 * Hard cap on single-trade fractional price impact (8%). Without it a large
 * trade could crash a name in one execution — the analog of exchange circuit
 * breakers (CME/LME limits, NYSE Rule 80A). Big enough that small trades feel
 * inconsequential and aggressive sizing can't single-tick nuke a name.
 */
export const MAX_IMPACT = 0.08;
/** Max entries retained in MarketState.recentFlow. */
export const FLOW_CAP = 50;

// --- Margin (packages/engine/src/portfolio.ts) ---
/**
 * Initial margin rate for short positions: the fraction of notional reserved
 * as margin when a short opens (this cash is locked). 50% matches Reg-T.
 */
export const INITIAL_MARGIN_RATE = 0.5;
/**
 * Maintenance margin rate for short positions: the minimum equity (as a
 * fraction of CURRENT notional) that must remain, below which the position is
 * flagged for liquidation. 25% is a realistic maintenance requirement.
 */
export const MAINTENANCE_MARGIN_RATE = 0.25;

// --- Rival AI (packages/engine/src/rival.ts) ---
/** Rival reconsiders its book every N engine ticks. */
export const RIVAL_DECISION_TICKS = 10;
/** A trade is "crowded" when |netFlow| / liquidity exceeds this fraction. */
export const CROWD_FRAC = 0.02;
/** ...and the absolute flow exceeds this many dollars. */
export const CROWD_MIN_DOLLARS = 500_000;

// --- Fund fallback policies (packages/engine/src/policies.ts) ---
/** Gross exposure (longs + shorts at market) may not exceed this multiple of NAV. */
export const POLICY_MAX_GROSS_LEVERAGE = 1.5;
/** Smallest notional any policy will open, in dollars. */
export const POLICY_MIN_TRADE_DOLLARS = 1_000;
/** Cautious: close a position at or above this fractional gain. */
export const POLICY_CAUTIOUS_TAKE_PROFIT = 0.08;
/** Cautious: close a position at or below this fractional loss. */
export const POLICY_CAUTIOUS_STOP_LOSS = 0.06;
/** Cautious: only buys names with per-tick volatility at or below this. */
export const POLICY_CAUTIOUS_MAX_VOLATILITY = 0.02;
/** Cautious: a "dip" is a change from previous close at or below this. */
export const POLICY_CAUTIOUS_DIP = -0.01;
/** Aggressive: cover/close a position at or above this fractional gain. */
export const POLICY_AGGRESSIVE_TAKE_PROFIT = 0.1;
/** Aggressive: close a position at or below this fractional loss. */
export const POLICY_AGGRESSIVE_STOP_LOSS = 0.08;
/** Aggressive: shorts a name after an event at or below this % impact. */
export const POLICY_AGGRESSIVE_EVENT_IMPACT = -2;
/** Aggressive: an "overextended" name is up at least this fraction. */
export const POLICY_AGGRESSIVE_EXTENDED = 0.03;
/** Quant: net flow (dollars) below this magnitude is noise. */
export const POLICY_QUANT_MIN_FLOW = 250_000;

// --- Decision cycle & metering (server/budget.ts, server/providers) ---
/** Hard cap on provider spend across all funds per UTC day, in USD. */
export const GLOBAL_DAILY_BUDGET_USD = 10;
/** At most this many provider calls in flight at once, across all funds. */
export const MAX_CONCURRENT_LLM_CALLS = 2;
/** Model rounds per decision (research rounds + the final submit). */
export const MAX_TOOL_ROUNDS = 4;
/** max_tokens per model round (covers thinking at low effort + the answer). */
export const DECISION_MAX_TOKENS = 4096;
/** Prompt size assumed when reserving budget before a call, in tokens. */
export const DECISION_PROMPT_TOKENS_ESTIMATE = 3000;

// --- Events (packages/engine/src/events.ts) ---
/** Engine tick at which the first scripted event fires. */
export const EVENT_FIRST_FIRE_TICK = 15;
/** Base delay (ticks) between scripted events. */
export const EVENT_FIRE_DELAY_MIN = 15;
/** Random extra ticks in [0, EVENT_FIRE_DELAY_JITTER) added to the base delay. */
export const EVENT_FIRE_DELAY_JITTER = 6;
/** Per-tick probability of an ambient (non-scripted) event firing. */
export const EVENT_AMBIENT_CHANCE = 0.14;

// --- World (server/world.ts) ---
/** Seed for the live world's market RNG, used on first boot when WORLD_SEED is unset or invalid. */
export const WORLD_SEED = 20_261_102;
/** Name of the single persistent world humans observe. */
export const LIVE_WORLD_NAME = 'live';
