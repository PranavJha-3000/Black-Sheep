/**
 * Black Sheep — server-driven Zustand store.
 */
import { create } from 'zustand';
import { createFund, openPosition, closePosition, peakNav } from '@black-sheep/engine/portfolio';
import type { Fund } from '@black-sheep/engine/portfolio';
import { derive } from './derive';
import type { RiskLabel } from './derive';
import type { Ticker, Company, MarketEvent } from '@black-sheep/engine/types';
import type { ConfrontationEvent } from '@black-sheep/engine/rival';
import type { RivalFund } from '@black-sheep/engine/rival';
import { apiFetch } from './api';
import { projectState } from './stateMapper';
import type { ProjectionPrev } from './stateMapper';

export type Phase = 'auth' | 'lobby' | 'trading';

export interface GameSession {
  token: string;
  user: { id: number; email: string };
  roomCode: string;
  /** ms epoch of the last /state poll — drives the away-summary on rejoin. */
  lastSeenAt: number;
}

export interface GameStoreState {
  phase: Phase;
  token: string;
  user: { id: number; email: string } | null;
  roomCode: string;
  error: string;
  /** The caller's fund DB id (from /state me.fundId). Null before first poll. */
  fundId: number | null;
  /** The caller's fund display name (from /state me.name). */
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
  rivalNav: number;
  rivalThinking: boolean;
  events: MarketEvent[];
  flow: Record<Ticker, number>;
  confrontation: ConfrontationEvent | null;
  contested: Ticker[];
  rivalDecisionKey: string;
  awaySummary: unknown | null;
  /** ms epoch of the last /state poll — drives the away-summary fetch on rejoin. */
  lastSeenAt: number;
  liquidated: boolean;
  causeOfDeath: string;
  /** Server-computed cause from the latest LiquidationLog (null when alive). */
  liquidationCause: string | null;
  /** Rival context line from the latest LiquidationLog (null when irrelevant). */
  liquidationRivalContext: string | null;
  priceHistory: Record<Ticker, number[]>;
  navHistory: number[];
  rivalHistory: number[];
  selectedTicker: Ticker;
  // --- session / room actions ---
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  register: (email: string, password: string) => Promise<void>;
  clearError: () => void;
  createRoom: () => Promise<void>;
  joinRoom: (code: string) => Promise<void>;
  enterRoom: (roomCode: string) => void;
  leaveRoom: () => void;
  restart: () => void;
  setError: (error: string) => void;
  // --- trading / UI actions ---
  selectTicker: (ticker: Ticker) => void;
  buy: (ticker: Ticker, dollarAmount: number, leverage?: number) => void;
  short: (ticker: Ticker, dollarAmount: number, leverage?: number) => void;
  closePosition: (id: string) => void;
  dismissConfrontation: () => void;
  // --- poll / away ---
  poll: () => Promise<void>;
  fetchAwaySummary: (roomCode: string) => Promise<void>;
  dismissAwaySummary: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'black_sheep_session';

function loadSession(): GameSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameSession>;
    if (!parsed.token || !parsed.user || !parsed.roomCode) return null;
    return {
      token: parsed.token,
      user: parsed.user,
      roomCode: parsed.roomCode,
      lastSeenAt: typeof parsed.lastSeenAt === 'number' ? parsed.lastSeenAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function saveSession(session: GameSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

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

const SEED_FUND = createFund(10_000_000, 0);

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const _initSession = loadSession();
const _initPhase: Phase = _initSession ? 'lobby' : 'auth';
const _initCompanies = seedMarket();
const _initFund = SEED_FUND;
const _initAwaySummary = null;

export const useGameStore = create<GameStoreState>((set, get) => ({
  phase: _initPhase,
  token: _initSession ? _initSession.token : '',
  user: _initSession ? _initSession.user : null,
  roomCode: _initSession ? _initSession.roomCode : '',
  error: '',
  fundId: null,
  name: '',
  companies: _initCompanies as Record<Ticker, Company>,
  tickCount: 0,
  timestamp: 0,
  fund: _initFund,
  nav: 10_000_000,
  cash: 10_000_000,
  availCash: 10_000_000,
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
  peakNav: 10_000_000,
  rivalFund: { ...SEED_FUND, personality: 'contrarian' as const, lastDecision: null },
  rivalNav: 10_000_000,
  rivalThinking: false,
  events: [],
  flow: {},
  confrontation: null,
  contested: [],
  rivalDecisionKey: '',
  awaySummary: _initAwaySummary ?? null,
  lastSeenAt: _initSession ? _initSession.lastSeenAt : Date.now(),
  liquidated: false,
  causeOfDeath: '',
  liquidationCause: null,
  liquidationRivalContext: null,
  priceHistory: {},
  navHistory: [],
  rivalHistory: [],
  selectedTicker: 'NOVA' as Ticker,
  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  login: async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: { id: number; email: string } }>('/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password },
    });
    const session: GameSession = { token: data.token, user: data.user, roomCode: '', lastSeenAt: Date.now() };
    saveSession(session);
    set({ phase: 'lobby', token: data.token, user: data.user, roomCode: '', error: '' });
  },
  register: async (email: string, password: string) => {
    const data = await apiFetch<{ token: string; user: { id: number; email: string } }>('/auth/register', {
      method: 'POST',
      body: { email: email.trim(), password },
    });
    const session: GameSession = { token: data.token, user: data.user, roomCode: '', lastSeenAt: Date.now() };
    saveSession(session);
    set({ phase: 'lobby', token: data.token, user: data.user, roomCode: '', error: '' });
  },
  createRoom: async () => {
    const { token } = get();
    const data = await apiFetch<{ code: string }>('/rooms', { method: 'POST', token });
    get().enterRoom(data.code);
  },
  joinRoom: async (code: string) => {
    const { token } = get();
    await apiFetch(`/rooms/${code}/join`, { method: 'POST', token });
    get().enterRoom(code);
  },
  logout: () => {
    clearSession();
    set({
      phase: 'auth',
      token: '',
      user: null,
      roomCode: '',
      error: '',
      fund: SEED_FUND,
      awaySummary: null,
      confrontation: null,
      contested: [],
      liquidated: false,
    });
  },
  enterRoom: (roomCode: string) => {
    set({ phase: 'trading', roomCode, error: '' });
    // Fire the away-summary fetch after entering — non-blocking. The screen
    // shows only when the window was long AND something notable happened.
    void get().fetchAwaySummary(roomCode);
  },
  leaveRoom: () => {
    set({ phase: 'lobby', roomCode: '', awaySummary: null, confrontation: null, contested: [], liquidated: false });
  },
  restart: () => {
    clearSession();
    set({
      phase: 'auth',
      token: '',
      user: null,
      roomCode: '',
      error: '',
      companies: seedMarket(),
      fund: SEED_FUND,
      awaySummary: null,
      confrontation: null,
      contested: [],
      liquidated: false,
      priceHistory: {},
      navHistory: [],
      rivalHistory: [],
    });
  },
  fetchAwaySummary: async (roomCode: string) => {
    const { token, lastSeenAt } = get();
    if (!token) return;
    try {
      const since = lastSeenAt > 0 ? lastSeenAt : Date.now();
      const res = await apiFetch<{ notable: boolean } & Record<string, unknown>>(
        `/rooms/${roomCode}/away-summary?since=${since}`,
        { token },
      );
      // Only store the summary if it passes the notable gate — otherwise the
      // screen would show on every refresh and train players to dismiss it.
      if (res.notable) {
        set({ awaySummary: res });
      }
    } catch {
      // Away summary is best-effort — never break the rejoin over it.
    }
  },
  dismissAwaySummary: () => set({ awaySummary: null }),
  setError: (error: string) => set({ error }),
  clearError: () => set({ error: '' }),
  dismissConfrontation: () => set({ confrontation: null }),
  selectTicker: (ticker: Ticker) => set({ selectedTicker: ticker }),
  buy: (ticker: Ticker, dollarAmount: number, _leverage?: number) => {
    const { fund, companies } = get();
    const price = companies[ticker]?.price ?? 0;
    const updated = openPosition(fund, ticker, 'long', dollarAmount, price);
    if (updated === fund) return;
    const next = { ...get(), fund: updated };
    const d = derive({ companies }, next.fund);
    set({
      fund: next.fund,
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
      liquidationAt: d.liquidationAt,
      cashPct: d.cashPct,
      peakNav: peakNav(next.fund),
    });
  },
  short: (ticker: Ticker, dollarAmount: number, _leverage?: number) => {
    const { fund, companies } = get();
    const price = companies[ticker]?.price ?? 0;
    const updated = openPosition(fund, ticker, 'short', dollarAmount, price);
    if (updated === fund) return;
    const next = { ...get(), fund: updated };
    const d = derive({ companies }, next.fund);
    set({
      fund: next.fund,
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
      liquidationAt: d.liquidationAt,
      cashPct: d.cashPct,
      peakNav: peakNav(next.fund),
    });
  },
  closePosition: (id: string) => {
    const { fund, companies } = get();
    const pos = fund.positions.find((p) => p.id === id);
    const price = pos ? companies[pos.ticker]?.price ?? 0 : 0;
    const updated = closePosition(fund, id, price);
    if (updated === fund) return;
    const next = { ...get(), fund: updated };
    const d = derive({ companies }, next.fund);
    set({
      fund: next.fund,
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
      liquidationAt: d.liquidationAt,
      cashPct: d.cashPct,
      peakNav: peakNav(next.fund),
    });
  },
  poll: async () => {
    try {
      const { phase, token, roomCode, priceHistory, navHistory, rivalHistory, contested, confrontation, rivalDecisionKey } = get();
      if (phase !== 'trading' || !token || !roomCode) return;

      const raw = await apiFetch<Parameters<typeof projectState>[0]>(
        `/rooms/${roomCode}/state`,
        { token },
      );

      const prev: ProjectionPrev = {
        priceHistory,
        navHistory,
        rivalHistory,
        contested,
        confrontation,
        rivalDecisionKey,
      };
      const p = projectState(raw, prev);

      // Stamp lastSeenAt on every successful poll — this is the timestamp the
      // away-summary endpoint uses as the window start on rejoin.
      const now = Date.now();
      const session = loadSession();
      if (session) {
        session.lastSeenAt = now;
        saveSession(session);
      }

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
        causeOfDeath: p.liquidationCause ?? '',
        liquidationCause: p.liquidationCause,
        liquidationRivalContext: p.liquidationRivalContext,
        priceHistory: p.priceHistory,
        navHistory: p.navHistory,
        rivalNav: p.rivalNav,
        rivalHistory: p.rivalHistory,
        rivalFund: p.rivalFund,
        rivalThinking: p.rivalThinking,
        events: p.events,
        flow: p.flow,
        confrontation: p.confrontation,
        contested: p.contested,
        rivalDecisionKey: p.rivalDecisionKey,
        lastSeenAt: now,
      });
    } catch {
      // silent — next poll retries
    }
  },
}));
