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
import type { ActivityPayload, FundTracePayload } from '../../server/observerCore';
import type { AnalyticsPayload } from '../../server/analyticsCore';
import type { ExperimentDetail, ExperimentSummary } from '../../server/labCore';
import type { LeaderboardRow } from '../../server/leaderboardCore';
import { ANALYTICS_POLL_MS, LAB_POLL_MS, STARTING_CAPITAL } from '../../config/game';

/** Observer navigation (VISION §13). */
export type ObserverView = 'world' | 'funds' | 'fund' | 'activity' | 'analytics' | 'lab' | 'timeline';

/** The run a TIMELINE card selected (Task 10 replays it). */
export interface SelectedRun {
  experimentId: number;
  arm: string;
  seed: number;
}

/** How many of the newest done experiments TIMELINE loads runs from. */
export const CHRONICLE_MAX_EXPERIMENTS = 10;
/** Sidebar order; a null view is listed but not live yet. */
export const NAV_ITEMS: { label: string; view: ObserverView | null }[] = [
  { label: 'World', view: 'world' },
  { label: 'Funds', view: 'funds' },
  { label: 'Fund Detail', view: 'fund' },
  { label: 'Activity', view: 'activity' },
  { label: 'Timeline', view: 'timeline' },
  { label: 'Research Lab', view: 'lab' },
  { label: 'Analytics', view: 'analytics' },
];

export interface GameStoreState {
  view: ObserverView;
  /** The fund FUND DETAIL investigates; the focus projection follows it. */
  selectedFundId: number | null;
  /** FUND DETAIL's decision traces and memory (fetched only in that view). */
  trace: FundTracePayload | null;
  /** The ACTIVITY feed (fetched only in that view). */
  activity: ActivityPayload | null;
  /** ANALYTICS metrics (fetched only in that view). */
  analytics: AnalyticsPayload | null;
  setView: (view: ObserverView) => void;
  openFund: (fundId: number) => void;
  /** RESEARCH LAB (fetched only in that view). */
  lab: { list: ExperimentSummary[] | null; detail: ExperimentDetail | null };
  /** TIMELINE archive (fetched only in that view): the leaderboard and done experiments' details by id. */
  chronicle: { board: LeaderboardRow[] | null; list: ExperimentSummary[] | null; details: Record<number, ExperimentDetail>; failed: boolean };
  selectedRun: SelectedRun | null;
  selectRun: (run: SelectedRun | null) => void;
  selectedExperimentId: number | null;
  openExperiment: (id: number) => void;
  /** POST a new experiment. The admin token is used for this request only and never stored. */
  createExperiment: (body: unknown, token: string) => Promise<{ ok: true; id: number } | { ok: false; error: string }>;
  /** Server-side dry run: validates the request and returns its worst-case model spend; queues nothing. */
  estimateExperiment: (body: unknown, token: string) => Promise<{ ok: true; estimateUsd: number } | { ok: false; error: string }>;
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

type SeedState = Omit<
  GameStoreState,
  'reset' | 'selectTicker' | 'poll' | 'selectedTicker' | 'view' | 'selectedFundId' | 'trace' | 'activity' | 'analytics' | 'setView' | 'openFund' | 'lab' | 'chronicle' | 'selectedRun' | 'selectRun' | 'selectedExperimentId' | 'openExperiment' | 'createExperiment' | 'estimateExperiment'
>;

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

/** When the analytics fetch last started; 0 forces a fetch on the next poll. */
let analyticsFetchedAt = 0;
/** When the lab list was last fetched; 0 forces a fetch. */
let labFetchedAt = 0;
/** When the chronicle archive was last fetched; 0 forces a fetch. */
let chronicleFetchedAt = 0;

export const useGameStore = create<GameStoreState>((set, get) => ({
  ...seedState(),
  selectedTicker: 'NOVA' as Ticker,
  view: 'world' as ObserverView,
  selectedFundId: null,
  trace: null,
  activity: null,
  analytics: null,
  lab: { list: null, detail: null },
  chronicle: { board: null, list: null, details: {}, failed: false },
  selectedRun: null,
  selectedExperimentId: null,
  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  reset: () => set(seedState()),
  selectTicker: (ticker: Ticker) => set({ selectedTicker: ticker }),
  setView: (view: ObserverView) => {
    analyticsFetchedAt = 0;
    labFetchedAt = 0;
    chronicleFetchedAt = 0;
    set({ view });
    void get().poll();
  },
  openFund: (fundId: number) => {
    set({ view: 'fund', selectedFundId: fundId, trace: null });
    void get().poll();
  },
  selectRun: (run) => set({ selectedRun: run }),
  openExperiment: (id: number) => {
    labFetchedAt = 0;
    set({ view: 'lab', selectedExperimentId: id, lab: { ...get().lab, detail: null } });
    void fetchLab();
  },
  createExperiment: async (body: unknown, token: string) => {
    try {
      const { id } = await apiFetch<{ id: number }>('/lab/experiments', { method: 'POST', body, token });
      get().openExperiment(id);
      return { ok: true as const, id };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
  estimateExperiment: async (body: unknown, token: string) => {
    try {
      const { estimateUsd } = await apiFetch<{ estimateUsd: number }>('/lab/experiments?dryRun=1', { method: 'POST', body, token });
      return { ok: true as const, estimateUsd };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
  poll: async () => {
    try {
      const { priceHistory, navHistory, rivalDecisionKey, fundId, view, selectedFundId } = get();
      // Only the open view's investigation endpoint is polled.
      if (view === 'lab') void fetchLab();
      if (view === 'timeline') void fetchChronicle();
      const wantAnalytics = view === 'analytics' && Date.now() - analyticsFetchedAt >= ANALYTICS_POLL_MS;
      if (wantAnalytics) analyticsFetchedAt = Date.now();
      const [raw, trace, activity, analytics] = await Promise.all([
        apiFetch<WorldStatePayload>('/world/state'),
        view === 'fund' && selectedFundId !== null
          ? apiFetch<FundTracePayload>(`/world/funds/${selectedFundId}/trace`).catch(() => null)
          : Promise.resolve(null),
        view === 'activity' ? apiFetch<ActivityPayload>('/world/activity').catch(() => null) : Promise.resolve(null),
        wantAnalytics ? apiFetch<AnalyticsPayload>('/world/analytics').catch(() => null) : Promise.resolve(null),
      ]);

      const prev: ProjectionPrev = {
        priceHistory,
        navHistory,
        rivalDecisionKey,
        focusFundId: fundId,
      };
      // The selection changed while this poll was in flight: a newer poll owns
      // the focus, so this projection (built for the old fund) is dropped.
      if (get().selectedFundId !== selectedFundId) return;
      const p = projectState(raw, prev, selectedFundId);
      // A trace answering an older selection is dropped.
      if (trace && trace.fundId === get().selectedFundId) set({ trace });
      if (activity) set({ activity });
      if (analytics) set({ analytics });

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

/** RESEARCH LAB polling: the list and the open experiment, at most every LAB_POLL_MS. */
async function fetchLab(): Promise<void> {
  if (Date.now() - labFetchedAt < LAB_POLL_MS) return;
  labFetchedAt = Date.now();
  const id = useGameStore.getState().selectedExperimentId;
  const [list, detail] = await Promise.all([
    apiFetch<{ experiments: ExperimentSummary[] }>('/lab/experiments').catch(() => null),
    id !== null ? apiFetch<ExperimentDetail>(`/lab/experiments/${id}`).catch(() => null) : Promise.resolve(null),
  ]);
  const { lab, selectedExperimentId } = useGameStore.getState();
  useGameStore.setState({
    lab: {
      list: list?.experiments ?? lab.list,
      // A detail answering an experiment no longer selected is dropped.
      detail: detail && id === selectedExperimentId ? detail : lab.detail,
    },
  });
}

/** TIMELINE: leaderboard + list, then details of the newest done experiments not yet held (done results never change). */
async function fetchChronicle(): Promise<void> {
  if (Date.now() - chronicleFetchedAt < LAB_POLL_MS) return;
  chronicleFetchedAt = Date.now();
  const [board, list] = await Promise.all([
    apiFetch<{ leaderboard: LeaderboardRow[] }>('/lab/leaderboard').catch(() => null),
    apiFetch<{ experiments: ExperimentSummary[] }>('/lab/experiments').catch(() => null),
  ]);
  const { chronicle, lab } = useGameStore.getState();
  const experiments = list?.experiments ?? chronicle.list;
  const newest = (experiments ?? [])
    .filter((e) => e.status === 'done')
    .sort((a, b) => b.id - a.id)
    .slice(0, CHRONICLE_MAX_EXPERIMENTS);
  const details = { ...chronicle.details };
  // Reuse the lab view's open detail; fetch only what is still missing.
  if (lab.detail && newest.some((e) => e.id === lab.detail!.id)) details[lab.detail.id] = lab.detail;
  const missing = newest.filter((e) => !details[e.id]);
  const fetched = await Promise.all(missing.map((e) => apiFetch<ExperimentDetail>(`/lab/experiments/${e.id}`).catch(() => null)));
  for (const d of fetched) if (d) details[d.id] = d;
  useGameStore.setState({ chronicle: { board: board?.leaderboard ?? chronicle.board, list: experiments, details, failed: !experiments } });
}
