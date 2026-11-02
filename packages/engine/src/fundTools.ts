/*
 * Black Sheep - fund research tools (VISION §9, core tools).
 *
 * Provider-agnostic tool definitions plus PURE handlers. Every handler reads
 * only the fund's own RivalDecisionInput - the same firewalled view the
 * prompt is built from - so a tool can never reveal another fund's book or
 * touch live state. The server adapter turns ToolSpecs into provider tools and
 * routes tool calls here.
 *
 * submit_decision is the terminal tool: the model ends its research by
 * calling it, and its input is parsed (never trusted) into a RivalDecision.
 */

import { availableCash, positionPnl } from './portfolio';
import { maxNewPositionDollars } from './policies';
import { normaliseDecision } from './rivalLLM';
import type { FundProfile } from './funds';
import type { RivalDecision, RivalDecisionInput } from './rival';

/** A tool as JSON Schema; the server maps it onto the provider's tool type. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export const SUBMIT_DECISION = 'submit_decision';

export const FUND_TOOLS: ToolSpec[] = [
  {
    name: 'inspect_company',
    description: 'Fundamentals for one listed company: price, change, volatility, beta, rate sensitivity, liquidity, net flow, sector peers and its recent events.',
    input_schema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Listed ticker, e.g. NOVA' } },
      required: ['ticker'],
      additionalProperties: false,
    },
  },
  {
    name: 'inspect_portfolio',
    description: 'Your own book: cash, available cash and every open position with entry price, current price and P&L.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'calculate_risk',
    description: 'Your risk: NAV, gross and net exposure, leverage and the largest new position your limits allow.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'recent_events',
    description: 'Recent market events (earnings, macro, sector, company news), optionally for one ticker.',
    input_schema: {
      type: 'object',
      properties: { ticker: { type: 'string', description: 'Optional ticker filter' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: SUBMIT_DECISION,
    description: 'Submit your ONE decision for this cycle. Call exactly once, after any research.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['buy', 'short', 'close', 'hold'] },
        ticker: { type: 'string', description: 'Required for buy/short/close' },
        dollarAmount: { type: 'number', description: 'Notional in whole dollars for buy/short' },
        reasoning: { type: 'string', description: 'One or two sentences' },
        confidence: { type: 'number', description: '0.0 to 1.0' },
      },
      required: ['action', 'reasoning', 'confidence'],
      additionalProperties: false,
    },
  },
];

export type ToolResult = { ok: true; output: unknown } | { ok: false; output: { error: string } };

const fail = (error: string): ToolResult => ({ ok: false, output: { error } });

function tickerArg(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const t = (args as Record<string, unknown>).ticker;
  return typeof t === 'string' ? t.toUpperCase() : undefined;
}

/** Run one research tool against the fund's own view. Never throws. */
export function runFundTool(name: string, args: unknown, input: RivalDecisionInput, profile: FundProfile): ToolResult {
  switch (name) {
    case 'inspect_company': {
      const ticker = tickerArg(args);
      const c = input.companies.find((x) => x.ticker === ticker);
      if (!c) return fail(`unknown ticker ${ticker ?? '(missing)'}`);
      return {
        ok: true,
        output: {
          ...c,
          netFlow: input.netFlow[c.ticker] ?? 0,
          peers: input.companies.filter((x) => x.sector === c.sector && x.ticker !== c.ticker).map((x) => x.ticker),
          events: input.events.filter((e) => e.ticker === c.ticker || e.sector === c.sector),
        },
      };
    }
    case 'inspect_portfolio': {
      const own = input.ownFund;
      return {
        ok: true,
        output: {
          cash: own.cash,
          availableCash: availableCash(own),
          positions: own.positions.map((p) => {
            const price = input.companies.find((c) => c.ticker === p.ticker)?.price ?? p.entryPrice;
            return { ticker: p.ticker, direction: p.direction, quantity: p.quantity, entryPrice: p.entryPrice, price, pnl: positionPnl(p, price) };
          }),
        },
      };
    }
    case 'calculate_risk': {
      const own = input.ownFund;
      let nav = own.cash;
      let gross = 0;
      let net = 0;
      for (const p of own.positions) {
        const value = (input.companies.find((c) => c.ticker === p.ticker)?.price ?? p.entryPrice) * p.quantity;
        const signed = p.direction === 'long' ? value : -value;
        nav += signed;
        gross += value;
        net += signed;
      }
      return {
        ok: true,
        output: {
          nav,
          grossExposure: gross,
          netExposure: net,
          leverage: nav > 0 ? gross / nav : 0,
          availableCash: availableCash(own),
          maxNewPositionDollars: maxNewPositionDollars(input, profile),
        },
      };
    }
    case 'recent_events': {
      const ticker = tickerArg(args);
      return { ok: true, output: ticker ? input.events.filter((e) => e.ticker === ticker) : input.events };
    }
    default:
      return fail(`unknown tool ${name}`);
  }
}

/** Parse submit_decision input; null when the model sent a malformed decision. */
export function parseSubmittedDecision(args: unknown): RivalDecision | null {
  return normaliseDecision(args);
}
