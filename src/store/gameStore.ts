/**
 * Black Sheep — observer store: a projection of the public live world
 * (GET /world/state). No accounts, no sessions, no lobby.
 */
import { create } from 'zustand';
import { createFund } from '@black-sheep/engine/portfolio';
import { createInitialMarket } from '@black-sheep/engine/market';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { RiskLabel } from './derive';
import type { Ticker, Company, MarketEvent } from '@black-sheep/engine/types';
import type { RivalFund } from '@black-sheep/engine/rival';
import { apiFetch } from './api';
import { projectState } from './stateMapper';
import type { FundSummary, ProjectionPrev } from './stateMapper';
import type { WorldStatePayload } from '../../server/worldCore';
import { STARTING_CAPITAL } from '../../config/game';

export interface GameStoreState {
  /** The focus fund's DB id (lowest id in the world). Null before a fund exists. */
  fundId: number | null;
  /** The focus fund's display name. */
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
  liquidationAt: number;
  cashPct: number;
  peakNav: number;
  rivalFund: RivalFund;
  rivalThinking: boolean;
  events: MarketEvent[];
  flow: Record<Ticker, number>;
  rivalDecisionKey: string;
  liquidated: boolean;
  /** Server-computed cause from the latest LiquidationLog (null when alive). */
  liquidationCause: string | null;
  priceHistory: Record<Ticker, number[]>;
  navHistory: number[];
  /** Every fund in the world, for the funds strip. */
  funds: FundSummary[];
  selectedTicker: Ticker;
  /** Reset the projection to the seed state (before the first poll). */
  reset: () => void;
  // --- UI actions ---
  selectTicker: (ticker: Ticker) => void;
  // --- poll ---
  poll: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The engine's listed universe, shown until the first poll lands. */
function seedMarket(): Record<Ticker, Company> {
  return createInitialMarket().companies;
}

const SEED_FUND = createFund(STARTING_CAPITAL, 0);

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type SeedState = Omit<GameStoreState, 'reset' | 'selectTicker' | 'poll' | 'selectedTicker'>;

function seedState(): SeedState {
  return {
    fundId: null,
    name: '',
    companies: seedMarket(),
    tickCount: 0,
    timestamp: 0,
    fund: SEED_FUND,
    nav: STARTING_CAPITAL,
    cash: STARTING_CAPITAL,
    availCash: STARTING_CAPITAL,
    unrealizedPnL: 0,
    dailyPnl: 0,
    dailyPnlPct: 0,
    grossExposure: 0,
    netExposure: 0,
    leverage: 0,
    marginUsedPercent: 0,
    atRisk: false,
    riskPct: 0,
    riskLabel: 'LOW',
    liquidationAt: 0,
    cashPct: 100,
    peakNav: STARTING_CAPITAL,
    rivalFund: { ...SEED_FUND, personality: 'contrarian' as const, lastDecision: null },
    rivalThinking: false,
    events: [],
    flow: {},
    rivalDecisionKey: '',
    liquidated: false,
    liquidationCause: null,
    priceHistory: {},
    navHistory: [],
    funds: [],
  };
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...seedState(),
  selectedTicker: 'NOVA' as Ticker,
  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  reset: () => set(seedState()),
  selectTicker: (ticker: Ticker) => set({ selectedTicker: ticker }),
  poll: async () => {
    try {
      const { priceHistory, navHistory, rivalDecisionKey } = get();
      const raw = await apiFetch<WorldStatePayload>('/world/state');

      const prev: ProjectionPrev = {
        priceHistory,
        navHistory,
        rivalDecisionKey,
      };
      const p = projectState(raw, prev);

      set({
        fundId: p.fundId,
        name: p.name,
        companies: p.companies,
        tickCount: p.tickCount,
        timestamp: p.timestamp,
        fund: p.fund,
        nav: p.nav,
        cash: p.cash,
        availCash: p.availCash,
        unrealizedPnL: p.unrealizedPnL,
        dailyPnl: p.dailyPnl,
        dailyPnlPct: p.dailyPnlPct,
        grossExposure: p.grossExposure,
        netExposure: p.netExposure,
        leverage: p.leverage,
        marginUsedPercent: p.marginUsedPercent,
        atRisk: p.atRisk,
        riskPct: p.riskPct,
        riskLabel: p.riskLabel,
        liquidationAt: p.liquidationAt,
        peakNav: p.peakNav,
        liquidated: p.liquidated,
        liquidationCause: p.liquidationCause,
        priceHistory: p.priceHistory,
        navHistory: p.navHistory,
        rivalFund: p.rivalFund,
        rivalThinking: p.rivalThinking,
        events: p.events,
        flow: p.flow,
        rivalDecisionKey: p.rivalDecisionKey,
        funds: p.funds,
      });
    } catch {
      // silent — next poll retries
    }
  },
}));
