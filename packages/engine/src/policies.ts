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
 *   quant      - exit when flow turns against a position, else follow the
 *                strongest flow relative to liquidity
 *   contrarian - the original crowd-fade twin (makeRandomDecision)
 *
 * Whatever the policy, a new position never exceeds the fund's
 * maxPositionFraction of available cash.
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
  POLICY_AGGRESSIVE_TAKE_PROFIT,
  POLICY_CAUTIOUS_DIP,
  POLICY_CAUTIOUS_MAX_VOLATILITY,
  POLICY_CAUTIOUS_STOP_LOSS,
  POLICY_CAUTIOUS_TAKE_PROFIT,
  POLICY_MIN_TRADE_DOLLARS,
  POLICY_QUANT_MIN_FLOW,
} from '../../../config/game';

export function decideByPolicy(profile: FundProfile, input: RivalDecisionInput): RivalDecision {
  const decision = pickPolicy(profile)(input, profile);
  return capSize(decision, input, profile);
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

/** Notional for a new position, or 0 when the fund cannot afford a trade. */
function sizeFor(input: RivalDecisionInput, profile: FundProfile): number {
  const avail = availableCash(input.ownFund);
  const size = Math.floor(avail * profile.maxPositionFraction);
  return size >= POLICY_MIN_TRADE_DOLLARS ? size : 0;
}

/** Clamp any opening decision to the fund's risk limit; drop it if unaffordable. */
function capSize(decision: RivalDecision, input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  if (decision.action !== 'buy' && decision.action !== 'short') return decision;
  const cap = sizeFor(input, profile);
  if (cap === 0) return hold(`${decision.ticker ?? 'Signal'} noted, but no capital is free for a new position.`);
  return { ...decision, dollarAmount: Math.min(decision.dollarAmount ?? cap, cap) };
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

/** First position that hit its profit target or stop, as a close decision. */
function exitOnTarget(input: RivalDecisionInput, takeProfit: number, stopLoss: number): RivalDecision | null {
  for (const pos of input.ownFund.positions) {
    const r = returnOf(input, pos);
    if (r === undefined) continue;
    const pct = `${(r * 100).toFixed(1)}%`;
    if (r >= takeProfit) {
      return { action: 'close', ticker: pos.ticker, reasoning: `${pos.ticker} ${pos.direction} is up ${pct}; banking it.`, confidence: 0.75 };
    }
    if (r <= -stopLoss) {
      return { action: 'close', ticker: pos.ticker, reasoning: `${pos.ticker} ${pos.direction} is down ${pct}; stop hit, cutting it.`, confidence: 0.8 };
    }
  }
  return null;
}

function held(input: RivalDecisionInput, ticker: Ticker): boolean {
  return input.ownFund.positions.some((p) => p.ticker === ticker);
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
    dollarAmount: sizeFor(input, profile),
    reasoning: `${best.ticker} is off ${(best.changePct * 100).toFixed(1)}% with low volatility; adding a measured position.`,
    confidence: 0.6,
  };
}

function aggressive(input: RivalDecisionInput, profile: FundProfile): RivalDecision {
  const exit = exitOnTarget(input, POLICY_AGGRESSIVE_TAKE_PROFIT, POLICY_AGGRESSIVE_STOP_LOSS);
  if (exit) return exit;

  const badNews = input.events
    .filter((e) => e.ticker && e.priceImpactPercent <= POLICY_AGGRESSIVE_EVENT_IMPACT && !held(input, e.ticker))
    .sort((a, b) => a.priceImpactPercent - b.priceImpactPercent)[0];
  if (badNews?.ticker) {
    return {
      action: 'short',
      ticker: badNews.ticker,
      dollarAmount: sizeFor(input, profile),
      reasoning: `${badNews.ticker} just printed bad news (${badNews.priceImpactPercent}%); pressing the short.`,
      confidence: 0.75,
    };
  }

  const extended = input.companies
    .filter((c) => c.changePct >= POLICY_AGGRESSIVE_EXTENDED && !held(input, c.ticker))
    .sort((a, b) => b.changePct - a.changePct)[0];
  if (extended) {
    return {
      action: 'short',
      ticker: extended.ticker,
      dollarAmount: sizeFor(input, profile),
      reasoning: `${extended.ticker} is up ${(extended.changePct * 100).toFixed(1)}% with nothing behind it; fading the move.`,
      confidence: 0.65,
    };
  }
  return hold('No broken stories or blow-off moves worth shorting yet.');
}

function quant(input: RivalDecisionInput, profile: FundProfile): RivalDecision {
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
    .filter((s) => Math.abs(s.flow) >= POLICY_QUANT_MIN_FLOW && !held(input, s.ticker))
    .sort((a, b) => b.strength - a.strength);
  const best = ranked[0];
  if (!best) return hold('No flow signal above the noise floor.');
  return {
    action: best.flow > 0 ? 'buy' : 'short',
    ticker: best.ticker,
    dollarAmount: sizeFor(input, profile),
    reasoning: `Strongest flow signal is ${best.ticker} ($${(best.flow / 1e6).toFixed(2)}M); following it.`,
    confidence: Math.min(0.9, 0.55 + best.strength * 5),
  };
}
