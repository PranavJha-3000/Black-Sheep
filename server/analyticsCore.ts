import { concentration, eventMetrics, seriesMetrics, type EventMetrics, type SeriesMetrics } from '@black-sheep/engine/metrics';

/**
 * analyticsCore — PURE builder for GET /world/analytics (VISION §11, §13 view 7).
 * The route aggregates rows; this turns them into per-fund financial and
 * AI-systems metrics plus world-level and Director statistics. Fields are
 * copied explicitly; nothing here is fund reasoning.
 */

export interface AnalyticsFundInput {
  id: number;
  name: string;
  personality: string | null;
  model: string | null;
  startingCapital: number;
  liquidated: boolean;
  /** NAV at each snapshot, oldest first. */
  navs: number[];
  /** Signed market value of each open position. */
  exposures: number[];
  /** Sum of entry notional of every position the fund opened (for turnover). */
  openedNotional: number;
  decisions: { total: number; bySource: Record<string, number> };
  calls: {
    count: number;
    byOutcome: Record<string, number>;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    totalLatencyMs: number;
    toolCalls: number;
  };
}

export interface DirectorStats {
  mode: string;
  cycles: number;
  applied: number;
  byKind: Record<string, number>;
}

export interface AnalyticsInput {
  funds: AnalyticsFundInput[];
  events: { type: string; priceImpactPercent: number }[];
  director: DirectorStats;
}

export interface FundAnalytics {
  id: number;
  name: string;
  personality: string | null;
  model: string | null;
  liquidated: boolean;
  financial: SeriesMetrics & { snapshots: number; turnover: number | null; largestShare: number; hhi: number };
  ai: {
    decisions: number;
    llmDecisions: number;
    /** Share of decisions not made by the model (policy, budget, busy). */
    fallbackRate: number | null;
    calls: number;
    /** Share of model calls that ended without a decision. */
    failureRate: number | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costPerLlmDecision: number | null;
    avgLatencyMs: number | null;
    toolCallsPerCall: number | null;
  };
}

export interface AnalyticsPayload {
  funds: FundAnalytics[];
  world: { events: EventMetrics; survival: { alive: number; total: number; rate: number | null } };
  director: DirectorStats;
  /** Honest limitations shown with the numbers (VISION §11). */
  notes: string[];
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

export function buildAnalytics(input: AnalyticsInput): AnalyticsPayload {
  const funds = input.funds.map((f): FundAnalytics => {
    const meanNav = f.navs.length > 0 ? f.navs.reduce((a, b) => a + b, 0) / f.navs.length : 0;
    const llmDecisions = f.decisions.bySource.llm ?? 0;
    const decided = f.calls.byOutcome.decided ?? 0;
    return {
      id: f.id,
      name: f.name,
      personality: f.personality,
      model: f.model,
      liquidated: f.liquidated,
      financial: {
        ...seriesMetrics(f.navs, f.startingCapital),
        snapshots: f.navs.length,
        turnover: ratio(f.openedNotional, meanNav),
        ...concentration(f.exposures),
      },
      ai: {
        decisions: f.decisions.total,
        llmDecisions,
        fallbackRate: ratio(f.decisions.total - llmDecisions, f.decisions.total),
        calls: f.calls.count,
        failureRate: ratio(f.calls.count - decided, f.calls.count),
        inputTokens: f.calls.inputTokens,
        outputTokens: f.calls.outputTokens,
        costUsd: f.calls.costUsd,
        costPerLlmDecision: ratio(f.calls.costUsd, llmDecisions),
        avgLatencyMs: ratio(f.calls.totalLatencyMs, f.calls.count),
        toolCallsPerCall: ratio(f.calls.toolCalls, f.calls.count),
      },
    };
  });
  const alive = input.funds.filter((f) => !f.liquidated).length;
  return {
    funds,
    world: { events: eventMetrics(input.events), survival: { alive, total: input.funds.length, rate: ratio(alive, input.funds.length) } },
    director: input.director,
    notes: [
      'Sharpe and volatility are per NAV snapshot (every 3 ticks), not annualised.',
      'One world, one run: no baselines or confidence intervals until multiple experiment worlds exist.',
      'Turnover = entry notional opened / mean NAV over the recorded snapshots.',
    ],
  };
}
