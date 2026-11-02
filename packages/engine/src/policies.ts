/*
 * Black Sheep - deterministic fund policies (the rule-based brains).
 *
 * Every fund has a fallback that needs no model: when no provider key is
 * configured, or a provider call fails, the fund still trades in character.
 * One pure policy per personality, all reading the same RivalDecisionInput the
 * LLM sees (so the information firewall is identical) and all returning a
 * RivalDecision that goes through the engine's normal validation.
 *
 *   cautious   - take profit / stop loss, else buy the deepest low-vol dip
 *   aggressive - cover winners / stop losers, else short bad news or the most
 *                overextended gainer
 *   quant      - stop losers, exit when flow turns against a position, else
 *                follow the strongest flow relative to liquidity
 *   contrarian - the original crowd-fade twin (makeRandomDecision)
 *
 * No policy shorts a name more volatile than POLICY_MAX_SHORT_VOLATILITY: it
 * could gap past the margin limit between two decisions.
 *
 * Whatever the policy, a new position never exceeds the fund's
 * maxPositionFraction of min(NAV, available cash), and the book's gross
 * exposure never exceeds POLICY_MAX_GROSS_LEVERAGE × NAV.
 */

import { availableCash, positionPnl } from './portfolio';
import { makeRandomDecision } from './rival';
import type { RivalDecision, RivalDecisionInput } from './rival';
import type { FundProfile } from './funds';
import type { Position, Ticker } from './types';
import {
  POLICY_AGGRESSIVE_EVENT_IMPACT,
  POLICY_AGGRESSIVE_EXTENDED,
  POLICY_AGGRESSIVE_STOP_LOSS,
  POLICY_MAX_SHORT_VOLATILITY,
  POLICY_QUANT_STOP_LOSS,
  POLICY_AGGRESSIVE_TAKE_PROFIT,
  POLICY_CAUTIOUS_DIP,
  POLICY_CAUTIOUS_MAX_VOLATILITY,
  POLICY_CAUTIOUS_STOP_LOSS,
  POLICY_CAUTIOUS_TAKE_PROFIT,
  POLICY_MAX_GROSS_LEVERAGE,
  POLICY_MIN_TRADE_DOLLARS,
  POLICY_QUANT_MIN_FLOW,
} from '../../../config/game';

export function decideByPolicy(profile: FundProfile, input: RivalDecisionInput): RivalDecision {
  const decision = pickPolicy(profile)(input, profile);
  return enforceRiskLimit(decision, input, profile);
}

type Policy = (input: RivalDecisionInput, profile: FundProfile) => RivalDecision;

function pickPolicy(profile: FundProfile): Policy {
  switch (profile.personality) {
    case 'cautious':
      return cautious;
    case 'aggressive':
      return aggressive;
    case 'quant':
      return quant;
    default:
      return (input) => makeRandomDecision(input);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function hold(reasoning: string): RivalDecision {
  return { action: 'hold', reasoning, confidence: 0.5 };
}

/**
 * Notional for a new position, or 0 when the fund cannot afford a trade.
 *
 * Sized against NAV, not cash: opening a short credits its proceeds to cash,
 * so cash-based sizing would compound with every short. The gross-exposure
 * ceiling bounds the whole book, not just one trade.
 */
export function maxNewPositionDollars(input: RivalDecisionInput, profile: FundProfile): number {
  let nav = input.ownFund.cash;
  let gross = 0;
  for (const pos of input.ownFund.positions) {
    const value = (priceOf(input, pos.ticker) ?? pos.entryPrice) * pos.quantity;
    nav += pos.direction === 'long' ? value : -value;
    gross += value;
  }
  const avail = availableCash(input.ownFund);
  const room = nav * POLICY_MAX_GROSS_LEVERAGE - gross;
  const size = Math.floor(Math.min(Math.min(avail, nav) * profile.maxPositionFraction, room));
  return size >= POLICY_MIN_TRADE_DOLLARS ? size : 0;
}

/**
 * Clamp any opening decision to the fund's risk limit; turn it into a hold if
 * the fund cannot afford a trade. Applied to policy AND model decisions: the
 * LLM proposes, the fund's limits dispose. Closes and holds pass unchanged.
 */
export function enforceRiskLimit(decision: RivalDecision, input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  if (decision.action !== 'buy' && decision.action !== 'short') return decision;
  // A proposal with no usable size is not silently promoted to a max-size trade.
  if (!(typeof decision.dollarAmount === 'number' && decision.dollarAmount > 0)) {
    return hold(`${decision.ticker ?? 'Proposal'} had no valid size; standing aside.`);
  }
  const cap = maxNewPositionDollars(input, profile);
  if (cap === 0) return hold(`${decision.ticker ?? 'Signal'} noted, but no capital is free for a new position.`);
  return { ...decision, dollarAmount: Math.min(decision.dollarAmount, cap) };
}

function priceOf(input: RivalDecisionInput, ticker: Ticker): number | undefined {
  return input.companies.find((c) => c.ticker === ticker)?.price;
}

/** Fractional P&L of a position at the current price (+0.1 = up 10%). */
function returnOf(input: RivalDecisionInput, pos: Position): number | undefined {
  const price = priceOf(input, pos.ticker);
  const basis = pos.entryPrice * pos.quantity;
  if (price === undefined || basis <= 0) return undefined;
  return positionPnl(pos, price) / basis;
}

/**
 * One close per decision, so a stop always wins over a profit target and the
 * worst loss is cut first: banking a winner while a loser runs toward a margin
 * call is how a fund gets liquidated between two decisions.
 */
function exitOnTarget(input: RivalDecisionInput, takeProfit: number, stopLoss: number): RivalDecision | null {
  let worst: { pos: Position; r: number } | null = null;
  let winner: { pos: Position; r: number } | null = null;
  for (const pos of input.ownFund.positions) {
    const r = returnOf(input, pos);
    if (r === undefined) continue;
    if (r <= -stopLoss && (!worst || r < worst.r)) worst = { pos, r };
    if (r >= takeProfit && !winner) winner = { pos, r };
  }
  if (worst) {
    const { pos, r } = worst;
    return { action: 'close', ticker: pos.ticker, reasoning: `${pos.ticker} ${pos.direction} is down ${(r * 100).toFixed(1)}%; stop hit, cutting it.`, confidence: 0.8 };
  }
  if (winner) {
    const { pos, r } = winner;
    return { action: 'close', ticker: pos.ticker, reasoning: `${pos.ticker} ${pos.direction} is up ${(r * 100).toFixed(1)}%; banking it.`, confidence: 0.75 };
  }
  return null;
}

function held(input: RivalDecisionInput, ticker: Ticker): boolean {
  return input.ownFund.positions.some((p) => p.ticker === ticker);
}

/** Calm enough to short: cannot plausibly gap to a margin call between two decisions. */
function shortable(input: RivalDecisionInput, ticker: Ticker): boolean {
  const company = input.companies.find((c) => c.ticker === ticker);
  return company !== undefined && company.volatility <= POLICY_MAX_SHORT_VOLATILITY;
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

function cautious(input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  const exit = exitOnTarget(input, POLICY_CAUTIOUS_TAKE_PROFIT, POLICY_CAUTIOUS_STOP_LOSS);
  if (exit) return exit;

  const dips = input.companies
    .filter((c) => c.volatility <= POLICY_CAUTIOUS_MAX_VOLATILITY && c.changePct <= POLICY_CAUTIOUS_DIP && !held(input, c.ticker))
    .sort((a, b) => a.changePct - b.changePct);
  const best = dips[0];
  if (!best) return hold('Nothing cheap enough among quality names. Patience.');
  return {
    action: 'buy',
    ticker: best.ticker,
    dollarAmount: maxNewPositionDollars(input, profile),
    reasoning: `${best.ticker} is off ${(best.changePct * 100).toFixed(1)}% with low volatility; adding a measured position.`,
    confidence: 0.6,
  };
}

function aggressive(input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  const exit = exitOnTarget(input, POLICY_AGGRESSIVE_TAKE_PROFIT, POLICY_AGGRESSIVE_STOP_LOSS);
  if (exit) return exit;

  const badNews = input.events
    .filter((e) => e.ticker && e.priceImpactPercent <= POLICY_AGGRESSIVE_EVENT_IMPACT && !held(input, e.ticker) && shortable(input, e.ticker))
    .sort((a, b) => a.priceImpactPercent - b.priceImpactPercent)[0];
  if (badNews?.ticker) {
    return {
      action: 'short',
      ticker: badNews.ticker,
      dollarAmount: maxNewPositionDollars(input, profile),
      reasoning: `${badNews.ticker} just printed bad news (${badNews.priceImpactPercent}%); pressing the short.`,
      confidence: 0.75,
    };
  }

  const extended = input.companies
    .filter((c) => c.changePct >= POLICY_AGGRESSIVE_EXTENDED && !held(input, c.ticker) && shortable(input, c.ticker))
    .sort((a, b) => b.changePct - a.changePct)[0];
  if (extended) {
    return {
      action: 'short',
      ticker: extended.ticker,
      dollarAmount: maxNewPositionDollars(input, profile),
      reasoning: `${extended.ticker} is up ${(extended.changePct * 100).toFixed(1)}% with nothing behind it; fading the move.`,
      confidence: 0.65,
    };
  }
  return hold('No broken stories or blow-off moves worth shorting yet.');
}

function quant(input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  // The flow signal says nothing about a gap; the stop does.
  const stop = exitOnTarget(input, Infinity, POLICY_QUANT_STOP_LOSS);
  if (stop) return stop;

  for (const pos of input.ownFund.positions) {
    const flow = input.netFlow[pos.ticker] ?? 0;
    const against = pos.direction === 'long' ? flow <= -POLICY_QUANT_MIN_FLOW : flow >= POLICY_QUANT_MIN_FLOW;
    if (against) {
      return { action: 'close', ticker: pos.ticker, reasoning: `Flow on ${pos.ticker} reversed against our ${pos.direction}; signal gone, exiting.`, confidence: 0.7 };
    }
  }

  const ranked = input.companies
    .map((c) => {
      const flow = input.netFlow[c.ticker] ?? 0;
      return { ticker: c.ticker, flow, strength: Math.abs(flow) / Math.max(1, c.liquidity) };
    })
    .filter((s) => Math.abs(s.flow) >= POLICY_QUANT_MIN_FLOW && !held(input, s.ticker) && (s.flow > 0 || shortable(input, s.ticker)))
    .sort((a, b) => b.strength - a.strength);
  const best = ranked[0];
  if (!best) return hold('No flow signal above the noise floor.');
  return {
    action: best.flow > 0 ? 'buy' : 'short',
    ticker: best.ticker,
    dollarAmount: maxNewPositionDollars(input, profile),
    reasoning: `Strongest flow signal is ${best.ticker} ($${(best.flow / 1e6).toFixed(2)}M); following it.`,
    confidence: Math.min(0.9, 0.55 + best.strength * 5),
  };
}
