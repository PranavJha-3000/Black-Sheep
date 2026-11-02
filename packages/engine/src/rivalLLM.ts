/*
 * Black Sheep - rival fund LLM brain.
 *
 * makeLLMDecision() is the async decision backend that plugs into the same
 * RivalDecisionInput / RivalDecision shell as makeRandomDecision(). It calls
 * the provider endpoint the SERVER supplies (the API key never leaves the
 * server), parses the JSON response defensively, and FALLS BACK
 * to the brain's deterministic policy on any failure so the world never stalls.
 *
 * The system prompt is the craft: persona, the crowded-trade thesis, event
 * awareness, and a hard instruction to emit ONLY strict JSON (with an in-prompt
 * example) so parsing is deterministic. Reasoning is capped to 1-2 sentences.
 */

import { makeRandomDecision } from './rival';
import type { RivalDecision, RivalDecisionInput } from './rival';
import type { FundProfile } from './funds';
import { DEFAULT_FUND_MODEL, MODEL_REGISTRY } from '../../../config/models';

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

/**
 * Provider endpoint, supplied by the server. Provider calls are server-only
 * (VISION §14.9): the server holds the key in its own env and passes it here
 * as a header. There is deliberately no browser default path.
 */
export interface LLMEndpointOptions {
  /** Full URL to POST the Anthropic messages body to. */
  url: string;
  /** Extra headers merged over the default content-type (e.g. x-api-key). */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** The response contract every fund's system prompt ends with. */
const JSON_CONTRACT = `CRITICAL: respond with ONLY a single JSON object, no prose before or no prose after, no markdown fences. Match this exact shape:
{"action":"buy|short|close|hold","ticker":"TICKER","dollarAmount":1234567,"reasoning":"One or two short sentences.","confidence":0.0}

- action is required. For "hold" you may omit ticker and dollarAmount.
- ticker is required for buy/short/close (use the existing position's ticker for close).
- dollarAmount is the notional in whole dollars for buy/short.
- confidence is 0.0 to 1.0.

Example correct response:
{"action":"short","ticker":"NOVA","dollarAmount":1800000,"reasoning":"Crowded long on NOVA with +$8M flow; fading the momentum before it unwinds.","confidence":0.82}`;

/** What every fund can and cannot see (the information firewall, in prose). */
const MARKET_VIEW = `You observe a live market shared with other AI funds. For each ticker you know: current price, recent % change, recent MarketEvents (earnings, news, macro), and net flow (signed dollars of buying vs selling pressure over the recent window - heavy positive flow means a trade is crowded long). You also get a vague aggregate-flow lean (heavy_tech / heavy_short / unknown).

You manage your own long/short book and available cash, which you can see in full. You NEVER see another fund's positions or cash. Decide ONE action: BUY, SHORT, CLOSE an existing position (use its ticker) or HOLD. Your reasoning MUST be 1-2 sentences.`;

export const RIVAL_SYSTEM_PROMPT = `You are the portfolio manager of APEX CAPITAL, a contrarian hedge fund. You are terse, confident, and slightly arrogant. You move against the crowd because crowded trades tend to unwind.

${MARKET_VIEW}

Rules:
- Fade crowded trades: heavy positive net flow leans you toward SHORT; heavy negative flow leans you toward BUY.
- Use recent MarketEvents for event-driven opportunities (a beat + flow = momentum you might ride briefly; a miss + flow = potential fade).
- Keep sizing reasonable relative to your available cash - do not bet the entire fund on one idea.

${JSON_CONTRACT}`;

/** The system prompt for a registered fund: its identity, mandate and limits. */
export function buildFundSystemPrompt(profile: FundProfile): string {
  return `You are the portfolio manager of ${profile.name}, an AI hedge fund.

Mandate: ${profile.mandate}
Strategy: ${profile.strategy}

${MARKET_VIEW}

Rules:
- Stay true to your mandate and strategy; do not drift into another fund's style.
- Never size a new position above ${Math.round(profile.maxPositionFraction * 100)}% of your NAV; calculate_risk reports the exact limit.
- HOLD is a legitimate decision when nothing fits your strategy.

Tools: research only as much as the decision needs - inspect_company, inspect_portfolio, calculate_risk, recent_events - then finish by calling submit_decision exactly once.
If tools are unavailable, reply instead with a single JSON object.

${JSON_CONTRACT}`;
}

export function buildRivalUserMessage(input: RivalDecisionInput): string {
  const own = input.ownFund;
  const lines: string[] = [];
  lines.push(`Your book: cash $${own.cash.toLocaleString('en-US')}, ${own.positions.length} open position(s).`);
  for (const p of own.positions) {
    lines.push(`  - ${p.direction.toUpperCase()} ${p.ticker}: qty ${p.quantity.toFixed(4)} @ $${p.entryPrice.toFixed(2)}`);
  }
  lines.push('');
  lines.push('Market:');
  for (const c of input.companies) {
    const flow = input.netFlow[c.ticker] ?? 0;
    lines.push(
      `  ${c.ticker} (${c.sector}) price $${c.price.toFixed(2)} change ${(c.changePct * 100).toFixed(2)}% ` +
        `liquidity $${(c.liquidity / 1e6).toFixed(0)}M netflow $${(flow / 1e6).toFixed(2)}M`,
    );
  }
  if (input.events.length > 0) {
    lines.push('');
    lines.push('Recent events:');
    for (const e of input.events.slice(0, 5)) {
      lines.push(
        `  - [${e.type}${e.ticker ? ' ' + e.ticker : ''}${e.sector ? ' ' + e.sector : ''}] ${e.headline} (${e.priceImpactPercent > 0 ? '+' : ''}${e.priceImpactPercent}%)`,
      );
    }
  }
  lines.push('');
  lines.push(`Aggregate flow lean: ${input.estimatedPlayerSectorExposure}.`);
  lines.push('Decide now: finish with submit_decision (or ONLY the JSON object if tools are unavailable).');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Cost guard
// ---------------------------------------------------------------------------

/**
 * Decide whether anything material has changed since the last decision.
 *
 * WHY THIS MATTERS FOR COST: at scale this game could run many rivals across
 * many sessions. The naive approach fires an LLM call every decision tick
 * (here every 10 ticks) regardless of whether the world changed. Most ticks
 * nothing material moves, so most calls would return the same "hold" and burn
 * tokens for nothing. This cheap structural check (event set changed, or any
 * ticker's net flow moved meaningfully) gates the expensive call. If nothing
 * changed we reuse the last decision instead of paying for a redundant one.
 */
export function shouldRivalReconsider(input: RivalDecisionInput, last: RivalDecisionInput | null): boolean {
  if (!last) return true;
  // New events since last decision?
  const lastIds = new Set(last.events.map((e: { id: string }) => e.id));
  const newEvents = input.events.some((e: { id: string }) => !lastIds.has(e.id));
  if (newEvents) return true;
  // Any ticker's net flow moved by more than the threshold dollars?
  for (const t of Object.keys(input.netFlow)) {
    const a = input.netFlow[t] ?? 0;
    const b = last.netFlow[t] ?? 0;
    if (Math.abs(a - b) > 250_000) return true;
  }
  // Rival's own book changed (positions added/removed)?
  if (input.ownFund.positions.length !== last.ownFund.positions.length) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/** Pull the raw text out of an Anthropic messages response, tolerating shapes. */
function extractText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) {
      // Models that think emit thinking blocks before the text block.
      for (const block of obj.content) {
        if (block && typeof block === 'object' && typeof (block as Record<string, unknown>).text === 'string') {
          return (block as Record<string, unknown>).text as string;
        }
      }
    }
    if (Array.isArray(obj.choices)) {
      const msg = obj.choices[0] as Record<string, unknown> | undefined;
      if (msg && typeof msg.message === 'object') {
        const content = (msg.message as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
    }
  }
  return '';
}

/** Strip ```json ... ``` fences if the model wrapped its answer anyway. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return fence[1].trim();
  return trimmed;
}

/** Find the first {...} object in a string (tolerates stray leading text). */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Parse a decision out of model text (fenced, prose-wrapped or bare JSON).
 * Returns null when there is no well-formed decision - callers fall back.
 */
export function parseDecisionText(text: string): RivalDecision | null {
  const jsonStr = firstJsonObject(stripFences(text));
  if (!jsonStr) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }
  return normaliseDecision(parsed);
}

/** Validate an untrusted value as a decision and normalise its fields. */
export function normaliseDecision(value: unknown): RivalDecision | null {
  if (!isRivalDecision(value)) return null;
  return {
    action: value.action,
    ticker: typeof value.ticker === 'string' ? value.ticker : undefined,
    dollarAmount: typeof value.dollarAmount === 'number' ? Math.floor(value.dollarAmount) : undefined,
    reasoning: value.reasoning,
    confidence: Math.min(1, Math.max(0, value.confidence)),
  };
}

function isRivalDecision(value: unknown): value is RivalDecision {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const okAction = v.action === 'buy' || v.action === 'short' || v.action === 'close' || v.action === 'hold';
  if (!okAction) return false;
  if (typeof v.reasoning !== 'string') return false;
  if (typeof v.confidence !== 'number') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Who is deciding: the fund's prompt, model, effort and no-model fallback. */
export interface FundBrain {
  system: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  fallback: (input: RivalDecisionInput) => RivalDecision;
}

const DEFAULT_BRAIN: FundBrain = {
  system: RIVAL_SYSTEM_PROMPT,
  model: DEFAULT_FUND_MODEL,
  effort: MODEL_REGISTRY[DEFAULT_FUND_MODEL].effort,
  fallback: makeRandomDecision,
};

/**
 * Output budget per decision. Current models think before answering, so the
 * budget covers thinking at the brain's effort plus a ~100-token JSON answer.
 */
const MAX_TOKENS = 2048;

/**
 * Ask the LLM for a fund decision. Never throws - any failure (network, HTTP,
 * refusal, malformed JSON) falls back to the brain's deterministic policy so
 * the world keeps running. Returns the parsed RivalDecision.
 */
export async function makeLLMDecision(
  input: RivalDecisionInput,
  endpoint: LLMEndpointOptions,
  brain: FundBrain = DEFAULT_BRAIN,
): Promise<RivalDecision> {
  const body = {
    model: brain.model,
    max_tokens: MAX_TOKENS,
    system: brain.system,
    output_config: { effort: brain.effort },
    messages: [{ role: 'user', content: buildRivalUserMessage(input) }],
  };

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(endpoint.headers ?? {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM proxy HTTP ${res.status}`);
    }
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && (data as Record<string, unknown>).stop_reason === 'refusal') {
      throw new Error('LLM refused');
    }
    const raw = extractText(data);
    if (!raw) throw new Error('LLM response had no text');
    const decision = parseDecisionText(raw);
    if (!decision) throw new Error('LLM response held no well-formed decision');
    return decision;
  } catch (err) {
    // Graceful degradation: the placeholder brain is correct-by-construction,
    // so a failed LLM call still produces a sane, executable decision.
    // In the browser `process` does not exist; guard so logging never throws.
    const nodeProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string> } }
    ).process;
    if (nodeProcess?.env?.NODE_ENV !== 'test') {
      console.warn('[rivalLLM] LLM call failed, falling back to rule-based policy:', err);
    }
    return brain.fallback(input);
  }
}
