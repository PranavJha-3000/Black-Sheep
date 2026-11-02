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
/** Per-request provider timeout and SDK retries: a hung call must not hold a concurrency slot for long. */
export const LLM_TIMEOUT_MS = 90_000;
export const LLM_MAX_RETRIES = 1;
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

// --- Agent memory (packages/engine/src/memory.ts, server/world.ts) ---
/** A reflection is written once this many closed trades accumulate since the last one. */
export const MEMORY_REFLECT_EVERY_CLOSES = 3;
/** Most recent memories per fund kept in the process (and loaded on boot). */
export const MEMORY_LOAD_LIMIT = 40;
/** Memories shown in the decision prompt. */
export const MEMORY_PROMPT_ENTRIES = 6;
/** recall_memory default and maximum result sizes. */
export const MEMORY_RECALL_DEFAULT = 10;
export const MEMORY_RECALL_MAX = 20;

// --- Observer API (server/observerCore.ts) ---
/** Tool-call JSON shown to observers is cut to this many characters. */
export const OBSERVER_JSON_MAX = 2000;
/** Decision traces returned per fund. */
export const OBSERVER_TRACE_LIMIT = 20;
/** Items in the activity feed. */
export const OBSERVER_ACTIVITY_LIMIT = 40;
/** NAV snapshots per fund used for analytics (newest). */
export const ANALYTICS_NAV_POINTS = 2000;
/** Recent market events used for world analytics. */
export const ANALYTICS_EVENT_LIMIT = 500;
/** ANALYTICS is aggregate and DB-heavy: refetched at most this often while open. */
export const ANALYTICS_POLL_MS = 15_000;

// --- Research Lab: controlled experiment worlds (VISION §10, D-032) ---
/** Longest experiment world, in engine ticks. */
export const EXPERIMENT_MAX_TICKS = 5000;
/** Most seeds (paired runs) per experiment. */
export const EXPERIMENT_MAX_SEEDS = 10;
/** Most arms (values of the varied variable) per experiment. */
export const EXPERIMENT_MAX_ARMS = 6;
/** NAV points kept per fund per arm for charts (the first seed's run). */
export const EXPERIMENT_SERIES_POINTS = 200;
/** How often the runner looks for a queued experiment. */
export const EXPERIMENT_POLL_MS = 2_000;
/** RESEARCH LAB list/detail refetch interval while the view is open. */
export const LAB_POLL_MS = 5_000;

// --- World Director (packages/engine/src/director.ts, server/world.ts) ---
/** 'none' | 'rule' | 'jev'. The DIRECTOR_MODE env var overrides it; 'jev' acts as 'none' until the Jev adapter is configured. */
export const DIRECTOR_MODE = 'rule';
/** The Director considers an intervention every this many ticks, in its own slot. */
export const DIRECTOR_EVERY_TICKS = 10;
/** Slot offset (funds use 0, 3 and 6). */
export const DIRECTOR_OFFSET = 9;
/** Minimum ticks between two interventions. */
export const DIRECTOR_COOLDOWN_TICKS = 60;
// Calibrated from 12k simulated ticks (Stage 8, D-029 revisit): ambient events
// fire every ~5 ticks and prices sit 7–14% from their mean-reversion anchor,
// so the original 30-tick / 1% / 5% thresholds were never met.
/** Only events with |impact| at least this many percent reset the quiet clock. */
export const DIRECTOR_MAJOR_EVENT_PCT = 5;
/** Ticks without a major event before the market counts as quiet (~75th percentile gap). */
export const DIRECTOR_QUIET_TICKS = 10;
/** Mean |change from anchor| below which the market counts as calm (~25th percentile). */
export const DIRECTOR_CALM_ABS_CHANGE = 0.09;
/** Mean |change from anchor| above which the market is already stressed: never intervene (~90th percentile). */
export const DIRECTOR_HOT_ABS_CHANGE = 0.14;
/** A quiet market whose mean change from anchor is at least this gets tightening (~90th percentile). */
export const DIRECTOR_RUNUP_CHANGE = 0.035;
