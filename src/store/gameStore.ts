/**
 * Black Sheep — observer store: a projection of the public live world
 * (GET /world/state). No accounts, no sessions, no lobby.
 */
import { create } from 'zustand';
import { createFund } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import type { RiskLabel } from './derive';
import type { Ticker, Company, MarketEvent } from '@black-sheep/engine/types';
import type { RivalFund } from '@black-sheep/engine/rival';
import { apiFetch } from './api';
import { projectState } from './stateMapper';
import type { ProjectionPrev } from './stateMapper';
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

function seedMarket(): Record<Ticker, Company> {
  return {
    NOVA: { ticker: 'NOVA', name: 'NOVA AI', sector: 'tech', price: 142.31, previousClose: 142.31, volatility: 0.035, beta: 1.3, rateSensitivity: 0.8, liquidity: 150_000_000 },
    TITAN: { ticker: 'TITAN', name: 'TITAN MOTORS', sector: 'auto', price: 87.12, previousClose: 87.12, volatility: 0.02, beta: 1.0, rateSensitivity: 0.7, liquidity: 200_000_000 },
    ORBL: { ticker: 'ORBL', name: 'ORBITAL DYNAMICS', sector: 'space', price: 203.44, previousClose: 203.44, volatility: 0.04, beta: 1.4, rateSensitivity: 0.6, liquidity: 80_000_000 },
    HELX: { ticker: 'HELX', name: 'HELIX SYSTEMS', sector: 'biotech', price: 61.28, previousClose: 61.28, volatility: 0.06, beta: 1.6, rateSensitivity: 0.5, liquidity: 40_000_000 },
    APXB: { ticker: 'APXB', name: 'APEX BANK', sector: 'finance', price: 34.9, previousClose: 34.9, volatility: 0.008, beta: 0.7, rateSensitivity: 1.6, liquidity: 1_200_000_000 },
    PULSE: { ticker: 'PULSE', name: 'PULSE', sector: 'consumer', price: 118.27, previousClose: 118.27, volatility: 0.006, beta: 0.5, rateSensitivity: 0.4, liquidity: 800_000_000 },
  };
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
      });
    } catch {
      // silent — next poll retries
    }
  },
}));
