import type { MemoryEntry } from '@black-sheep/engine/memory';
import { OBSERVER_JSON_MAX } from '../config/game';
import type { EventInput, ObservedMemory } from './worldCore';

/**
 * observerCore — PURE builders for the investigation endpoints (VISION §13):
 * why a fund decided, what it looked at, which tools it used and what
 * happened. Like buildWorldStatePayload, every field is copied explicitly so
 * a new DB column never leaks by accident. Agents never read these payloads.
 */

// --- inputs (DB rows as the route loads them) ------------------------------

export interface ToolRowInput {
  timestamp: Date;
  name: string;
  ok: boolean;
  latencyMs: number;
  inputJson: string;
  outputJson: string;
}

export interface CallRowInput {
  id: number;
  timestamp: Date;
  fundName: string;
  outcome: string;
  rounds: number;
  servedBy: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  error: string | null;
  toolCalls: ToolRowInput[];
}

export interface DecisionRowInput {
  id: number;
  timestamp: Date;
  fundName: string;
  tickCountAt: number | null;
  action: string;
  ticker: string | null;
  reasoning: string;
  confidence: number | null;
  source: string;
  model: string | null;
  fillPrice: number | null;
  realizedPnL: number | null;
  llmCall: CallRowInput | null;
}

export interface LiquidationRowInput {
  timestamp: Date;
  fundName: string;
  cause: string;
}

// --- payloads ---------------------------------------------------------------

export interface ToolTrace {
  name: string;
  ok: boolean;
  latencyMs: number;
  /** JSON text, truncated to OBSERVER_JSON_MAX. */
  input: string;
  output: string;
}

export interface CallTrace {
  outcome: string;
  rounds: number;
  servedBy: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  error: string | null;
  tools: ToolTrace[];
}

export interface DecisionTrace {
  id: number;
  at: string;
  tickCountAt: number | null;
  action: string;
  ticker: string | null;
  reasoning: string;
  confidence: number | null;
  source: string;
  model: string | null;
  fillPrice: number | null;
  realizedPnL: number | null;
  /** The model call behind the decision; null when a policy decided. */
  call: CallTrace | null;
}

export interface FundTracePayload {
  fundId: number;
  decisions: DecisionTrace[];
  memory: ObservedMemory[];
}

export type ActivityKind = 'decision' | 'call' | 'tool' | 'event' | 'liquidation';

export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  tickCountAt: number | null;
  /** Null for world events. */
  fundName: string | null;
  text: string;
  detail: string | null;
}

export interface ActivityPayload {
  items: ActivityItem[];
}

// --- builders ---------------------------------------------------------------

const clip = (s: string): string => (s.length > OBSERVER_JSON_MAX ? `${s.slice(0, OBSERVER_JSON_MAX)}…` : s);

function toolTrace(t: ToolRowInput): ToolTrace {
  return { name: t.name, ok: t.ok, latencyMs: t.latencyMs, input: clip(t.inputJson), output: clip(t.outputJson) };
}

function callTrace(c: CallRowInput): CallTrace {
  return {
    outcome: c.outcome,
    rounds: c.rounds,
    servedBy: c.servedBy,
    inputTokens: c.inputTokens,
    outputTokens: c.outputTokens,
    costUsd: c.costUsd,
    latencyMs: c.latencyMs,
    error: c.error,
    tools: c.toolCalls.map(toolTrace),
  };
}

/** One fund's decisions (as given, newest first) with their model calls, plus its memory newest first. */
export function buildFundTrace(fundId: number, rows: DecisionRowInput[], memory: MemoryEntry[]): FundTracePayload {
  return {
    fundId,
    decisions: rows.map((r) => ({
      id: r.id,
      at: r.timestamp.toISOString(),
      tickCountAt: r.tickCountAt,
      action: r.action,
      ticker: r.ticker,
      reasoning: r.reasoning,
      confidence: r.confidence,
      source: r.source,
      model: r.model,
      fillPrice: r.fillPrice,
      realizedPnL: r.realizedPnL,
      call: r.llmCall ? callTrace(r.llmCall) : null,
    })),
    memory: [...memory].reverse().map((m) => ({ kind: m.kind, tickCountAt: m.tickCountAt, subject: m.subject, content: m.content })),
  };
}

export interface ActivityInput {
  decisions: DecisionRowInput[];
  /** Model calls; each call's tool calls become their own items. */
  calls: CallRowInput[];
  events: EventInput[];
  liquidations: LiquidationRowInput[];
}

/** Everything that happened recently, newest first, capped at `limit`. */
export function buildActivity(input: ActivityInput, limit: number): ActivityPayload {
  const items: (ActivityItem & { ms: number })[] = [];
  for (const d of input.decisions) {
    items.push({
      kind: 'decision',
      ms: d.timestamp.getTime(),
      at: d.timestamp.toISOString(),
      tickCountAt: d.tickCountAt,
      fundName: d.fundName,
      text: `${d.action.toUpperCase()}${d.ticker ? ` ${d.ticker}` : ''} (${d.source})`,
      detail: d.reasoning,
    });
  }
  for (const c of input.calls) {
    items.push({
      kind: 'call',
      ms: c.timestamp.getTime(),
      at: c.timestamp.toISOString(),
      tickCountAt: null,
      fundName: c.fundName,
      text: `model call ${c.outcome} · ${c.rounds} round${c.rounds === 1 ? '' : 's'} · $${c.costUsd.toFixed(4)}`,
      detail: c.error,
    });
    for (const t of c.toolCalls) {
      items.push({
        kind: 'tool',
        ms: t.timestamp.getTime(),
        at: t.timestamp.toISOString(),
        tickCountAt: null,
        fundName: c.fundName,
        text: `${t.name}${t.ok ? '' : ' (error)'}`,
        detail: clip(t.inputJson),
      });
    }
  }
  for (const e of input.events) {
    items.push({
      kind: 'event',
      ms: e.timestamp.getTime(),
      at: e.timestamp.toISOString(),
      tickCountAt: e.tickCountAt,
      fundName: null,
      text: e.headline,
      detail: `${e.type}${e.ticker ? ` ${e.ticker}` : ''} ${e.priceImpactPercent > 0 ? '+' : ''}${e.priceImpactPercent}%`,
    });
  }
  for (const l of input.liquidations) {
    items.push({
      kind: 'liquidation',
      ms: l.timestamp.getTime(),
      at: l.timestamp.toISOString(),
      tickCountAt: null,
      fundName: l.fundName,
      text: 'LIQUIDATED',
      detail: l.cause,
    });
  }
  return {
    items: items
      .sort((a, b) => b.ms - a.ms)
      .slice(0, limit)
      .map(({ ms: _ms, ...item }) => item),
  };
}
