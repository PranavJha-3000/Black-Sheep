import type { RivalAction, RivalFund, RivalLastDecision } from '@black-sheep/engine/rival';
import { peakNav } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { Company, MarketEvent, MarketEventType, Position, Ticker } from '@black-sheep/engine/types';
import type { WorldStatePayload } from '../../server/worldCore';
import { derive, STARTING_CAPITAL } from './derive';
import type { RiskLabel } from './derive';

/**
 * stateMapper — the pure bridge from the wire (GET /world/state) to the
 * store shape every terminal component reads.
 *
 * The mapper is the separator between "what the server sends" and "what the
 * terminal renders". It exists so the whole multiplexer is unit-testable
 * without a network: feed it a state JSON and a snapshot of the previous
 * projection, get back the patches. Observation is public (D-017): humans see
 * every fund's book; agent isolation lives server-side in buildDecisionInput.
 */

// The wire type is WorldStatePayload, imported type-only from the server so
// the contract cannot drift. The terminal focuses one fund: the lowest id
// (funds arrive sorted by id). An empty world projects a seed fund.

/** What the previous projection contributed that we accumulate across polls. */
export interface ProjectionPrev {
  priceHistory: Record<Ticker, number[]>;
  navHistory: number[];
  rivalDecisionKey: string;
}

/** One fund's line in the funds strip: every fund in the world, at a glance. */
export interface FundSummary {
  id: number;
  name: string;
  nav: number;
  /** NAV vs starting capital, in percent. */
  pnlPct: number;
  liquidated: boolean;
  thinking: boolean;
  /** Null for a fund outside the registry. */
  personality: string | null;
  model: string | null;
  lastAction: string | null;
  /** Provider spend today and the daily budget (null outside the registry). */
  spendUsd: number | null;
  budgetUsd: number | null;
  /** 'llm' | 'policy' | 'budget' — who made the last decision. */
  lastSource: string | null;
}

/** The full set of store fields a poll writes. */
export interface Projection {
  fundId: number | null;
  name: string;
  companies: Record<Ticker, Company>;
  tickCount: number;
  timestamp: number;
  fund: Fund;
  nav: number;
  cash: number;
  availCash: number;
  unrealizedPnL: number;
  dailyPnl: number;
  dailyPnlPct: number;
  grossExposure: number;
  netExposure: number;
  leverage: number;
  marginUsedPercent: number;
  atRisk: boolean;
  riskPct: number;
  riskLabel: RiskLabel;
  cashPct: number;
  liquidationAt: number;
  peakNav: number;
  liquidated: boolean;
  liquidationCause: string | null;
  priceHistory: Record<Ticker, number[]>;
  navHistory: number[];
  rivalFund: RivalFund;
  rivalThinking: boolean;
  events: MarketEvent[];
  flow: Record<string, number>;
  rivalDecisionKey: string;
  funds: FundSummary[];
}

const HISTORY_CAP = 180;

function isMarketEventType(t: string): MarketEventType {
  return t === 'earnings' || t === 'macro' || t === 'sector' || t === 'company' ? t : 'company';
}

export function projectState(raw: WorldStatePayload, prev: ProjectionPrev): Projection {
  const companies = raw.market.companies as Record<Ticker, Company>;
  // Focus the lowest-id registered fund; a legacy fund outside the registry
  // never decides, so it only takes focus when nothing else exists.
  const focus = raw.funds.find((f) => f.profile !== null) ?? raw.funds[0] ?? null;

  // --- focus fund (seed fund while the world has none) ----------------------
  const fundBase: Fund = {
    cash: focus?.cash ?? STARTING_CAPITAL,
    startingCapital: focus?.startingCapital ?? STARTING_CAPITAL,
    realizedPnL: 0,
    positions: (focus?.positions ?? []).map(
      (p): Position => ({
        id: p.id,
        ticker: p.ticker,
        direction: p.direction,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        entryTimestamp: p.entryTimestamp,
        marginReserved: p.marginReserved,
      }),
    ),
    history: prev.navHistory.map((nav) => ({ timestamp: 0, nav })),
  };

  const d = derive({ companies }, fundBase);
  const navHistory = [...prev.navHistory, d.nav].slice(-HISTORY_CAP);
  const fund: Fund = {
    ...fundBase,
    history: [...fundBase.history, { timestamp: raw.world.timestamp, nav: d.nav }],
  };

  // --- price + fund history trails for charts ------------------------------
  const priceHistory: Record<Ticker, number[]> = {};
  for (const t of Object.keys(companies)) {
    priceHistory[t] = [...(prev.priceHistory[t] ?? []), companies[t].price].slice(-HISTORY_CAP);
  }

  // --- the focus fund's last decision (its "intel" line) ---------------------
  let lastDecision: RivalLastDecision | null = null;
  let rivalDecisionKey = prev.rivalDecisionKey;
  const rawDecision = focus?.lastDecision ?? null;

  if (rawDecision) {
    lastDecision = {
      action: rawDecision.action as RivalAction,
      ticker: (rawDecision.ticker ?? undefined) as Ticker | undefined,
      reasoning: rawDecision.reasoning,
      confidence: Number.isFinite(rawDecision.confidence ?? Number.NaN)
        ? Math.min(0.95, Math.max(0, rawDecision.confidence ?? 0.7))
        : 0.7,
      timestamp: rawDecision.tickCountAt ?? 0,
      fillPrice: rawDecision.fillPrice ?? undefined,
      realizedPnL: rawDecision.realizedPnL ?? undefined,
    };
    rivalDecisionKey = `${rawDecision.at}|${lastDecision.action}|${lastDecision.ticker ?? ''}`;
  }

  const rivalFund: RivalFund = {
    // Only `lastDecision` holds real data; the book itself is projected as
    // `fund` above, so these numeric fields are inert and no component reads them.
    cash: 0,
    positions: [],
    realizedPnL: 0,
    startingCapital: fundBase.startingCapital,
    history: [],
    personality: 'contrarian',
    lastDecision,
  };

  // --- news feed ------------------------------------------------------------
  const events: MarketEvent[] = raw.recentEvents.map((e) => ({
    id: `evt-${e.id}`,
    type: isMarketEventType(e.type),
    ticker: e.ticker ?? undefined,
    headline: e.headline,
    priceImpactPercent: e.priceImpactPercent,
    // Render in engine-tick units so the terminal clock stays meaningful.
    timestamp: e.tickCountAt ?? 0,
  }));

  return {
    fundId: focus?.id ?? null,
    name: focus?.name ?? '',
    companies,
    tickCount: raw.world.tickCount,
    timestamp: raw.world.timestamp,
    fund,
    nav: d.nav,
    cash: d.cash,
    availCash: d.availCash,
    unrealizedPnL: d.unrealizedPnL,
    dailyPnl: d.dailyPnl,
    dailyPnlPct: d.dailyPnlPct,
    grossExposure: d.grossExposure,
    netExposure: d.netExposure,
    leverage: d.leverage,
    marginUsedPercent: d.marginUsedPercent,
    atRisk: d.atRisk,
    riskPct: d.riskPct,
    riskLabel: d.riskLabel,
    cashPct: d.cashPct,
    liquidationAt: d.liquidationAt,
    peakNav: peakNav(fund),
    liquidated: focus?.liquidated ?? false,
    liquidationCause: focus?.liquidationCause ?? null,
    priceHistory,
    navHistory,
    rivalFund,
    rivalThinking: focus?.thinking ?? false,
    events,
    flow: raw.flow ?? {},
    rivalDecisionKey,
    funds: raw.funds.map((f) => ({
      id: f.id,
      name: f.name,
      nav: f.nav,
      pnlPct: f.startingCapital > 0 ? ((f.nav - f.startingCapital) / f.startingCapital) * 100 : 0,
      liquidated: f.liquidated,
      thinking: f.thinking,
      personality: f.profile?.personality ?? null,
      model: f.profile?.model ?? null,
      lastAction: f.lastDecision ? `${f.lastDecision.action.toUpperCase()}${f.lastDecision.ticker ? ' ' + f.lastDecision.ticker : ''}` : null,
      spendUsd: f.spend?.todayUsd ?? null,
      budgetUsd: f.spend?.dailyBudgetUsd ?? null,
      lastSource: f.lastDecision?.source ?? null,
    })),
  };
}
