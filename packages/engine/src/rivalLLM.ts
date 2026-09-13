/*
 * Black Sheep - rival fund LLM brain.
 *
 * makeLLMDecision() is the async decision backend that plugs into the same
 * RivalDecisionInput / RivalDecision shell as makeRandomDecision(). It calls
 * Anthropic (via a Vite dev proxy that keeps the API key server-side - the
 * browser never sees it), parses the JSON response defensively, and FALLS BACK
 * to makeRandomDecision() on any failure so the game never stalls on a hiccup.
 *
 * The system prompt is the craft: persona, the crowded-trade thesis, event
 * awareness, and a hard instruction to emit ONLY strict JSON (with an in-prompt
 * example) so parsing is deterministic. Reasoning is capped to 1-2 sentences.
 */

import { makeRandomDecision } from './rival';
import type { RivalDecision, RivalDecisionInput } from './rival';

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

/**
 * The browser NEVER calls Anthropic directly. It hits this same-origin path;
 * the Vite dev server proxies it to api.anthropic.com and injects the key from
 * the server environment. In production this would be a tiny edge function.
 * Keeping the key off the client is non-negotiable: it is a secret, not a
 * config value, and bundling it would leak it to anyone who opens DevTools.
 */
const LLM_PATH = '/api/llm';

/**
 * Optional endpoint override for non-browser callers.
 *
 * The game server runs the SAME brain (same prompt, same parsing, same twin
 * fallback) but calls Anthropic directly - it already holds the key in its own
 * env, so there is no proxy hop. The browser path stays untouched: default
 * args keep hitting the same-origin /api/llm proxy.
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

export const RIVAL_SYSTEM_PROMPT = `You are the portfolio manager of APEX CAPITAL, a contrarian hedge fund. You are terse, confident, and slightly arrogant. You move against the crowd because crowded trades tend to unwind.

You observe a live market. For each ticker you know: current price, recent % change, recent MarketEvents (earnings, news, macro), and net flow (signed dollars of buying vs selling pressure over the recent window - heavy positive flow means a trade is crowded long). You also have a vague read on the rival player's sector lean (heavy_tech / heavy_short / unknown), inferred only from aggregate flow.

You manage your own long/short book and available cash, which you can see in full. You NEVER see the rival player's actual positions or exact cash - that information is hidden from you. Decide ONE action.

Rules:
- Fade crowded trades: heavy positive net flow leans you toward SHORT; heavy negative flow leans you toward BUY.
- Use recent MarketEvents for event-driven opportunities (a beat + flow = momentum you might ride briefly; a miss + flow = potential fade).
- You may CLOSE an existing position (use its ticker) or HOLD.
- Keep sizing reasonable relative to your available cash - do not bet the entire fund on one idea.
- Brevity is a design goal. Your reasoning MUST be 1-2 sentences, not an essay.

CRITICAL: respond with ONLY a single JSON object, no prose before or no prose after, no markdown fences. Match this exact shape:
{"action":"buy|short|close|hold","ticker":"TICKER","dollarAmount":1234567,"reasoning":"One or two short sentences.","confidence":0.0}

- action is required. For "hold" you may omit ticker and dollarAmount.
- ticker is required for buy/short/close (use the existing position's ticker for close).
- dollarAmount is the notional in whole dollars for buy/short.
- confidence is 0.0 to 1.0.

Example correct response:
{"action":"short","ticker":"NOVA","dollarAmount":1800000,"reasoning":"Crowded long on NOVA with +$8M flow; fading the momentum before it unwinds.","confidence":0.82}`;

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
  lines.push(`Estimated player lean: ${input.estimatedPlayerSectorExposure}.`);
  lines.push('Decide now. Reply with ONLY the JSON object.');
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
      const first = obj.content[0];
      if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).text === 'string') {
        return (first as Record<string, unknown>).text as string;
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

/**
 * Ask the LLM for a rival decision. Never throws - any failure (network, HTTP,
 * malformed JSON) falls back to the deterministic rule-based twin so the game
 * keeps running. Returns the parsed RivalDecision.
 */
export async function makeLLMDecision(
  input: RivalDecisionInput,
  endpoint?: LLMEndpointOptions,
): Promise<RivalDecision> {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: RIVAL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildRivalUserMessage(input) }],
  };

  try {
    const res = await fetch(endpoint?.url ?? LLM_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(endpoint?.headers ?? {}) },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM proxy HTTP ${res.status}`);
    }
    const data: unknown = await res.json();
    const raw = extractText(data);
    if (!raw) throw new Error('LLM response had no text');
    const cleaned = stripFences(raw);
    const jsonStr = firstJsonObject(cleaned);
    if (!jsonStr) throw new Error('No JSON object in LLM response');
    const parsed: unknown = JSON.parse(jsonStr);
    if (!isRivalDecision(parsed)) throw new Error('LLM JSON did not match RivalDecision shape');
    return {
      action: parsed.action,
      ticker: typeof parsed.ticker === 'string' ? parsed.ticker : undefined,
      dollarAmount: typeof parsed.dollarAmount === 'number' ? Math.floor(parsed.dollarAmount) : undefined,
      reasoning: parsed.reasoning,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
    };
  } catch (err) {
    // Graceful degradation: the placeholder brain is correct-by-construction,
    // so a failed LLM call still produces a sane, executable decision.
    // In the browser `process` does not exist; guard so logging never throws.
    const nodeProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string> } }
    ).process;
    if (nodeProcess?.env?.NODE_ENV !== 'test') {
      console.warn('[rivalLLM] LLM call failed, falling back to rule-based twin:', err);
    }
    return makeRandomDecision(input);
  }
}
