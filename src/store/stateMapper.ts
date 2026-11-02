import type { RivalAction, RivalFund, RivalLastDecision } from '@black-sheep/engine/rival';
import { peakNav } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { Company, Direction, MarketEvent, MarketEventType, Position, Ticker } from '@black-sheep/engine/types';
import { derive } from './derive';
import type { RiskLabel } from './derive';

/**
 * stateMapper — the pure bridge from the wire (/rooms/:code/state) to the
 * store shape every Phase-2 component already reads.
 *
 * The mapper is the separator between "what the server sends" and "what the
 * terminal renders". It exists so the whole multiplexer is unit-testable
 * without a network: feed it a state JSON and a snapshot of the previous
 * projection, get back the patches. The rival's last decision is re-derived
 * from its persisted decision telemetry (the information firewall stays
 * intact: we never learn the rival's actual book).
 */

// ---------------------------------------------------------------------------
// Wire types (mirror of the /state response in server/rooms.ts)
// ---------------------------------------------------------------------------

export interface ApiPosition {
  id: string;
  ticker: Ticker;
  direction: Direction;
  quantity: number;
  entryPrice: number;
  entryTimestamp: number;
  marginReserved: number;
  price: number;
  pnl: number;
}

export interface ApiRivalDecision {
  action: string;
  ticker: Ticker | null;
  reasoning: string;
  confidence: number | null;
  fillPrice: number | null;
  realizedPnL: number | null;
  tickCountAt: number | null;
  at: string;
}

export interface ApiRoomState {
  room: { code: string; status: string; maxPlayers: number; tickCount: number };
  market: { timestamp: number; companies: Record<string, Company> };
  funds: Array<{ id: number; name: string; userId: number | null; nav: number; netExposure: number }>;
  me: {
    fundId: number;
    name: string;
    cash: number;
    availCash: number;
    nav: number;
    startingCapital: number;
    positions: ApiPosition[];
    liquidated: boolean;
    liquidationCause: string | null;
  };
  flow: Record<string, number>;
  rival: {
    name: string;
    thinking: boolean;
    lastDecision: ApiRivalDecision | null;
  };
  recentEvents: Array<{
    id: number;
    type: string;
    ticker: Ticker | null;
    headline: string;
    priceImpactPercent: number;
    tickCountAt: number | null;
    at: string;
  }>;
}

/** What the previous projection contributed that we accumulate across polls. */
export interface ProjectionPrev {
  priceHistory: Record<Ticker, number[]>;
  navHistory: number[];
  rivalDecisionKey: string;
}

/** The full set of store fields a poll writes. */
export interface Projection {
  fundId: number;
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
  rivalNav: number;
  rivalFund: RivalFund;
  rivalThinking: boolean;
  events: MarketEvent[];
  flow: Record<string, number>;
  rivalDecisionKey: string;
}

const HISTORY_CAP = 180;

function isMarketEventType(t: string): MarketEventType {
  return t === 'earnings' || t === 'macro' || t === 'sector' || t === 'company' ? t : 'company';
}

export function projectState(raw: ApiRoomState, prev: ProjectionPrev): Projection {
  const companies = raw.market.companies as Record<Ticker, Company>;

  // --- own fund -------------------------------------------------------------
  const fundBase: Fund = {
    cash: raw.me.cash,
    startingCapital: raw.me.startingCapital,
    realizedPnL: 0,
    positions: raw.me.positions.map(
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
    history: [...fundBase.history, { timestamp: raw.market.timestamp, nav: d.nav }],
  };

  // --- price + fund history trails for charts ------------------------------
  const priceHistory: Record<Ticker, number[]> = {};
  for (const t of Object.keys(companies)) {
    priceHistory[t] = [...(prev.priceHistory[t] ?? []), companies[t].price].slice(-HISTORY_CAP);
  }

// --- rival (display projection only — the real book stays on the server) ---
  const rivalRow = raw.funds.find((f) => f.userId === null);
  const rivalNav = Math.max(1, rivalRow?.nav ?? raw.me.startingCapital);

  let lastDecision: RivalLastDecision | null = null;
  let rivalDecisionKey = prev.rivalDecisionKey;
  const rawDecision = raw.rival.lastDecision;

  if (rawDecision) {
    lastDecision = {
      action: rawDecision.action as RivalAction,
      ticker: rawDecision.ticker ?? undefined,
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
    // Only `lastDecision` holds real data; the numeric fields are inert
    // fillers. The firewall protects the rival's actual book, so we never
    // know its cash/positions — and no component reads them.
    cash: 0,
    positions: [],
    realizedPnL: 0,
    startingCapital: raw.me.startingCapital,
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
    fundId: raw.me.fundId,
    name: raw.me.name,
    companies,
    tickCount: raw.room.tickCount,
    timestamp: raw.market.timestamp,
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
    liquidated: raw.me.liquidated,
    liquidationCause: raw.me.liquidationCause,
    priceHistory,
    navHistory,
    rivalNav,
    rivalFund,
    rivalThinking: raw.rival.thinking ?? false,
    events,
    flow: raw.flow ?? {},
    rivalDecisionKey,
  };
}
