/*
 * Black Sheep - rival fund engine (the mechanical shell the LLM plugs into).
 *
 * Pure TypeScript, zero UI deps (same purity rule as market.ts/portfolio.ts).
 * Everything here is a pure function: in -> new out, never mutate.
 *
 * Two decision backends share this shell:
 *   - makeRandomDecision()  : deterministic rule-based twin (placeholder)
 *   - makeLLMDecision()     : async LLM brain (rivalLLM.ts)
 * Both feed applyRivalDecision(), which routes through the SAME openPosition/
 * closePosition the player uses - no special-cased rival math.
 */

import { openPosition, closePosition, availableCash, positionPnl } from './portfolio';
import { getNetFlow } from './market';
import type { Fund } from './portfolio';
import type { Direction, MarketEvent, MarketState, Position, Sector, Ticker } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RivalPersonality = 'aggressive' | 'contrarian' | 'quant' | 'cautious';

export type RivalAction = 'buy' | 'short' | 'close' | 'hold';

export interface RivalDecision {
  action: RivalAction;
  ticker?: Ticker;
  /** Notional size in dollars. Optional for hold/close. */
  dollarAmount?: number;
  /** 1-2 sentence thesis. Shown verbatim in the UI. */
  reasoning: string;
  /** 0..1 conviction. */
  confidence: number;
}

/**
 * What we persist on the fund so the UI can show the rival's last call.
 *
 * `fillPrice`/`realizedPnL` are execution telemetry written by
 * applyRivalDecision — what HAPPENED, not what the brain chose. They let
 * detectConfrontation judge "is the player losing here?" from the close price
 * alone, keeping it a pure two-argument detector with no market snapshot.
 */
export interface RivalLastDecision extends RivalDecision {
  timestamp: number;
  fillPrice?: number;
  realizedPnL?: number;
}

/** A rival fund is the player fund + a personality + its last decision. */
export interface RivalFund extends Fund {
  personality: RivalPersonality;
  lastDecision: RivalLastDecision | null;
}

/** Vague read on the player, derived cheaply from flow - never leaks positions. */
export type PlayerSectorExposure = 'heavy_tech' | 'heavy_short' | 'unknown';

/** Per-ticker market view the rival is allowed to see. */
export interface RivalCompanyView {
  ticker: Ticker;
  price: number;
  previousClose: number;
  changePct: number;
  liquidity: number;
  sector: Sector;
  volatility: number;
}

/**
 * The ONLY information the rival's decision function may see.
 *
 * Deliberately excludes the player's positions and exact cash. A rival fund can
 * read public market data (prices, flow, events) and its own book, but never
 * another fund's books. Keeping this boundary in one type is what makes the
 * LLM swappable and the information firewall testable.
 */
export interface RivalDecisionInput {
  ownFund: RivalFund;
  companies: RivalCompanyView[];
  /** Signed net flow per ticker over the lookback window (buys positive). */
  netFlow: Record<Ticker, number>;
  events: MarketEvent[];
  market: { tickCount: number; timestamp: number };
  estimatedPlayerSectorExposure: PlayerSectorExposure;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rival reconsiders its book every N ticks. */
export const RIVAL_DECISION_TICKS = 10;
/** getNetFlow lookback window (ticks). */
const FLOW_LOOKBACK = 15;
/** A trade is "crowded" when |netFlow|/liquidity exceeds this. */
const CROWD_FRAC = 0.02;
/** ...and the absolute flow exceeds this many dollars. */
const CROWD_MIN_DOLLARS = 500_000;

/** Display name of the rival fund. Lives here (not the store) so engine-side
 *  headline strings can use it; the store re-exports it for the UI. */
export const RIVAL_NAME = 'APEX CAPITAL';
/** A rival close counts as "a large gain" at or above this many dollars. */
const CONFRONT_GAIN_MIN = 50_000;
/** Fraction of available cash the rival puts to work on a single idea. */
const POSITION_FRACTION = 0.18;

// ---------------------------------------------------------------------------
// Fund lifecycle
// ---------------------------------------------------------------------------

export function createRivalFund(
  startingCapital: number,
  personality: RivalPersonality,
  timestamp = 0,
): RivalFund {
  return {
    cash: startingCapital,
    positions: [],
    realizedPnL: 0,
    startingCapital,
    history: [{ timestamp, nav: startingCapital }],
    personality,
    lastDecision: null,
  };
}

// ---------------------------------------------------------------------------
// Input assembly (the information firewall lives here)
// ---------------------------------------------------------------------------

/** Bucket signed flow by sector over a lookback window, return a vague label. */
function estimateExposure(
  flow: { ticker: Ticker; direction: 'buy' | 'sell'; dollarAmount: number; timestamp: number }[],
  byTicker: Record<Ticker, { sector: Sector }>,
  now: number,
): PlayerSectorExposure {
  const cutoff = now - FLOW_LOOKBACK;
  const bySector: Record<string, number> = {};
  let total = 0;
  for (const f of flow) {
    if (f.timestamp < cutoff) continue;
    const sector = byTicker[f.ticker]?.sector ?? 'unknown';
    const signed = f.direction === 'buy' ? f.dollarAmount : -f.dollarAmount;
    bySector[sector] = (bySector[sector] ?? 0) + signed;
    total += signed;
  }
  if (total < -1_000_000) return 'heavy_short';
  let bestSector = '';
  let bestVal = 0;
  for (const [s, v] of Object.entries(bySector)) {
    if (Math.abs(v) > Math.abs(bestVal)) {
      bestVal = v;
      bestSector = s;
    }
  }
  if (bestSector === 'tech' && bestVal > 1_000_000) return 'heavy_tech';
  return 'unknown';
}

/**
 * Build the rival's restricted view of the world.
 *
 * `recentFlow` is passed in (not read from the market) so the firewall is
 * explicit - callers decide what flow the rival may see. We derive a vague
 * player-sector label from it; we never pass raw player positions.
 */
export function buildDecisionInput(
  ownFund: RivalFund,
  market: MarketState,
  events: MarketEvent[],
  recentFlow: { ticker: Ticker; direction: 'buy' | 'sell'; dollarAmount: number; timestamp: number }[],
): RivalDecisionInput {
  const companies: RivalCompanyView[] = Object.values(market.companies).map((c) => ({
    ticker: c.ticker,
    price: c.price,
    previousClose: c.previousClose,
    changePct: c.previousClose > 0 ? (c.price - c.previousClose) / c.previousClose : 0,
    liquidity: c.liquidity,
    sector: c.sector,
    volatility: c.volatility,
  }));

  const netFlow: Record<Ticker, number> = {};
  for (const t of Object.keys(market.companies)) {
    netFlow[t] = getNetFlow(market, t, FLOW_LOOKBACK);
  }

  return {
    ownFund,
    companies,
    netFlow,
    events,
    market: { tickCount: market.tickCount, timestamp: market.timestamp },
    estimatedPlayerSectorExposure: estimateExposure(recentFlow, market.companies, market.timestamp),
  };
}

// ---------------------------------------------------------------------------
// Rule-based decision twin (deterministic placeholder)
// ---------------------------------------------------------------------------

interface CrowdSignal {
  ticker: Ticker;
  netFlow: number;
  liquidity: number;
  strength: number;
  crowdedLong: boolean;
}

/**
 * Contrarian heuristic: find the most crowded ticker and lean against it.
 *
 * Crowded long  -> short it (fade the momentum).
 * Crowded short -> buy it   (cover the panic).
 * If we're already on the wrong side of that ticker, close first.
 * No crowd      -> hold.
 */
export function makeRandomDecision(input: RivalDecisionInput): RivalDecision {
  const { netFlow, companies, ownFund } = input;

  const signals: CrowdSignal[] = companies
    .map((c) => {
      const nf = netFlow[c.ticker] ?? 0;
      const liquidity = c.liquidity > 0 ? c.liquidity : 1;
      return {
        ticker: c.ticker,
        netFlow: nf,
        liquidity,
        strength: Math.abs(nf) / liquidity,
        crowdedLong: nf > 0,
      };
    })
    .filter((s) => s.strength > CROWD_FRAC && Math.abs(s.netFlow) > CROWD_MIN_DOLLARS);

  if (signals.length === 0) {
    return {
      action: 'hold',
      reasoning: 'No crowded trades on the tape. Standing aside.',
      confidence: 0.5,
    };
  }

  signals.sort((a, b) => b.strength - a.strength);
  const best = signals[0];

  // Already positioned the wrong way? Get out before the crowd runs us over.
  const existing = ownFund.positions.find((p) => p.ticker === best.ticker);
  if (existing) {
    const squeezed =
      (existing.direction === 'short' && best.crowdedLong) ||
      (existing.direction === 'long' && !best.crowdedLong);
    if (squeezed) {
      return {
        action: 'close',
        ticker: best.ticker,
        reasoning: `Crowd piling into ${best.ticker}; closing our ${existing.direction} before the squeeze.`,
        confidence: 0.72,
      };
    }
  }

  const action: RivalAction = best.crowdedLong ? 'short' : 'buy';
  const avail = availableCash(ownFund);
  if (avail <= 0) {
    return {
      action: 'hold',
      reasoning: `${best.ticker} looks crowded ${best.crowdedLong ? 'long' : 'short'} but we are out of cash.`,
      confidence: 0.4,
    };
  }
  const dollarAmount = Math.max(1_000, Math.floor(avail * POSITION_FRACTION));
  const confidence = Math.min(0.95, 0.6 + best.strength * 4);
  const dir = best.crowdedLong ? 'long' : 'short';
  return {
    action,
    ticker: best.ticker,
    dollarAmount,
    reasoning: `Crowded ${dir} on ${best.ticker} (+$${(best.netFlow / 1e6).toFixed(1)}M flow); fading the move.`,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Decision application (shared by both backends)
// ---------------------------------------------------------------------------

/**
 * Execute a decision against the rival fund using the player's engine.
 *
 * Returns the SAME reference on a no-op (hold, or a trade the engine rejects),
 * otherwise a new fund. `lastDecision` is always recorded so the UI can show
 * the rival's reasoning even when a trade is rejected.
 */
export function applyRivalDecision(rivalFund: RivalFund, decision: RivalDecision, market: MarketState): RivalFund {
  const timestamp = market.timestamp;
  const lastDecision: RivalLastDecision = { ...decision, timestamp };

  // `extra` carries execution telemetry (fillPrice / realizedPnL) into the
  // recorded decision — it documents what happened, not what was decided.
  const withDecision = (base: Fund, extra?: Partial<RivalLastDecision>): RivalFund => ({
    ...base,
    personality: rivalFund.personality,
    lastDecision: extra ? { ...lastDecision, ...extra } : lastDecision,
  });

  switch (decision.action) {
    case 'hold':
      return withDecision(rivalFund);

    case 'close': {
      if (!decision.ticker) return withDecision(rivalFund);
      const pos = rivalFund.positions.find((p) => p.ticker === decision.ticker);
      if (!pos) return withDecision(rivalFund);
      const price = market.companies[pos.ticker]?.price ?? 0;
      const closed = closePosition(rivalFund, pos.id, price);
      if (closed === rivalFund) return withDecision(rivalFund);
      // Realized P&L attributable to this single close.
      const realized = closed.realizedPnL - rivalFund.realizedPnL;
      return withDecision(closed, { fillPrice: price, realizedPnL: realized });
    }

    case 'buy':
    case 'short': {
      if (!decision.ticker || !decision.dollarAmount) return withDecision(rivalFund);
      const direction = decision.action === 'buy' ? 'long' : 'short';
      const price = market.companies[decision.ticker]?.price ?? 0;
      const opened = openPosition(rivalFund, decision.ticker, direction, decision.dollarAmount, price);
      // openPosition returns the same ref when it rejects the trade — record
      // the decision, but no execution telemetry, because nothing filled.
      if (opened === rivalFund) return withDecision(rivalFund);
      return withDecision(opened, { fillPrice: price });
    }

    default:
      return withDecision(rivalFund);
  }
}

// ---------------------------------------------------------------------------
// Confrontation detection (the "Billions moment")
// ---------------------------------------------------------------------------

/** A moment of direct player-vs-rival contact worth shouting about. */
export interface ConfrontationEvent {
  /** rival opened against the player | rival banked a gain while the player bleeds */
  kind: 'opposite' | 'rival_win';
  ticker: Ticker;
  /** Banner headline. Shown in the terminal alert, ALL CAPS. */
  headline: string;
  /** The rival's own reasoning line, shown beneath the headline. */
  rivalReasoning: string;
  /** For rival_win: what the rival realized on the close, in dollars. */
  rivalGain?: number;
}

/**
 * Flag direct confrontation between the player's book and the rival's last
 * executed decision. Two triggers:
 *
 *  1. opposite  - the rival just opened a position directly opposite the
 *                 player's on the same ticker (shorts what you're long and
 *                 vice versa).
 *  2. rival_win - the rival just closed for a large gain on a ticker where the
 *                 player is currently losing. "Currently" is evaluated at the
 *                 close price carried on the decision telemetry, so no market
 *                 snapshot is needed — which keeps this a pure two-argument
 *                 detector as specced.
 *
 * Returns null when nothing confrontational happened. Pure.
 */
export function detectConfrontation(
  playerPositions: Position[],
  rivalDecision: RivalLastDecision,
): ConfrontationEvent | null {
  const { action, ticker } = rivalDecision;
  if (!ticker) return null;
  const playerPos = playerPositions.find((p) => p.ticker === ticker);
  if (!playerPos) return null;

  if (action === 'buy' || action === 'short') {
    const rivalDir: Direction = action === 'buy' ? 'long' : 'short';
    // Same side is alignment, not confrontation.
    if (playerPos.direction === rivalDir) return null;
    const headline =
      rivalDir === 'short'
        ? `${RIVAL_NAME} IS NOW SHORT ${ticker} — DIRECTLY AGAINST YOUR POSITION`
        : `${RIVAL_NAME} IS NOW LONG ${ticker} — DIRECTLY AGAINST YOUR SHORT`;
    return { kind: 'opposite', ticker, headline, rivalReasoning: rivalDecision.reasoning };
  }

  if (action === 'close') {
    const gain = rivalDecision.realizedPnL;
    const price = rivalDecision.fillPrice;
    if (gain === undefined || price === undefined || gain < CONFRONT_GAIN_MIN) return null;
    // Player must actually be losing on that name right now.
    if (positionPnl(playerPos, price) >= 0) return null;
    return {
      kind: 'rival_win',
      ticker,
      headline: `${RIVAL_NAME} BANKED +${fmtK(gain)} ON ${ticker} — WHILE YOU'RE UNDERWATER ON IT`,
      rivalReasoning: rivalDecision.reasoning,
      rivalGain: gain,
    };
  }

  return null;
}

/** "$412K"-style dollar formatting for headlines (engine-side, no UI deps). */
function fmtK(n: number): string {
  return `$${Math.round(n / 1000).toLocaleString('en-US')}K`;
}


