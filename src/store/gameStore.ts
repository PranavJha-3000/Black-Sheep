import { create } from 'zustand';
import { tickMarket, createInitialMarket, applyEvent, mulberry32 } from '../engine/market';
import { generateEvent, maybeFireScriptedEvent, initialScheduler } from '../engine/events';
import type { SchedulerState } from '../engine/events';
import { createFund, openPosition as engOpen, closePosition as engClose, markToMarket, getExposure, checkLiquidation, availableCash, positionPnl, liquidateFund, deriveCauseOfDeath, peakNav } from '../engine/portfolio';
import type { Company, MarketEvent, Ticker } from '../engine/types';
import type { Fund } from '../engine/portfolio';
export const STARTING_CAPITAL = 10_000_000;
export const RIVAL_NAME = 'APEX CAPITAL';
const CAP = 160;
export type RiskLabel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export interface GameStore {
  companies: Record<Ticker, Company>; tickCount: number; timestamp: number;
  fund: Fund; events: MarketEvent[]; priceHistory: Record<Ticker, number[]>;
  navHistory: number[]; rivalNav: number; rivalHistory: number[]; selectedTicker: Ticker;
  nav: number; cash: number; availCash: number; unrealizedPnL: number;
  dailyPnl: number; dailyPnlPct: number; grossExposure: number; netExposure: number;
  leverage: number; marginUsedPercent: number; atRisk: boolean;
  riskPct: number; riskLabel: RiskLabel; cashPct: number; liquidationAt: number;
  liquidated: boolean; causeOfDeath: string; peakNav: number;
  scheduler: SchedulerState;
  tick: () => void; buy: (t: Ticker, d: number, l?: number) => void;
  short: (t: Ticker, d: number, l?: number) => void; closePosition: (id: string) => void;
  selectTicker: (t: Ticker) => void;
  restart: () => void;
}
export function clampN(n: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, n)); }
function seedEvents(): MarketEvent[] {
  return [
    { id: 's1', type: 'company', ticker: 'NOVA', headline: 'NOVA AI announces new model', priceImpactPercent: 3.1, timestamp: -8 },
    { id: 's2', type: 'company', ticker: 'TITAN', headline: 'TITAN MOTORS faces regulatory review', priceImpactPercent: -2.2, timestamp: -12 },
    { id: 's3', type: 'company', ticker: 'APXB', headline: 'APEX BANK beats Q3 results', priceImpactPercent: 1.8, timestamp: -15 },
    { id: 's4', type: 'company', ticker: 'HELX', headline: 'HELIX SYSTEMS CFO to step down', priceImpactPercent: -1.4, timestamp: -19 },
  ];
}
export function derive(market: { companies: Record<Ticker, Company> }, fund: Fund) {
  const mkt = market as Parameters<typeof markToMarket>[1];
  const r = markToMarket(fund, mkt);
  const e = getExposure(fund, mkt);
  const liq = checkLiquidation(fund, mkt);
  const avail = availableCash(fund);
  const leverage = r.nav > 0 ? e.grossExposure / r.nav : 0;
  let shortGross = 0;
  for (const p of fund.positions) { if (p.direction === 'short') shortGross += Math.abs((mkt.companies[p.ticker]?.price ?? 0) * p.quantity); }
  const shortShare = e.grossExposure > 0 ? shortGross / e.grossExposure : 0;
  const marginTerm = Number.isFinite(liq.marginUsedPercent) ? clampN(liq.marginUsedPercent, 0, 100) * 0.25 : 25;
  const riskPct = fund.positions.length === 0 ? 0 : clampN((e.grossExposure / Math.max(r.nav, 1)) * 55 + marginTerm + shortShare * 10, 0, 100);
  const riskLabel: RiskLabel = riskPct < 25 ? 'LOW' : riskPct < 55 ? 'MODERATE' : riskPct < 80 ? 'HIGH' : 'CRITICAL';
  let tma = 0; let tmm = 0;
  for (const p of fund.positions) { if (p.direction !== 'short') continue; const px = mkt.companies[p.ticker]?.price ?? 0; tma += p.marginReserved + positionPnl(p, px); tmm += 0.25 * px * p.quantity; }
  const hasShort = fund.positions.some((pp) => pp.direction === 'short');
  const liqAt = hasShort ? Math.max(0, r.nav - Math.max(tma - tmm, 0)) : Math.max(0, r.nav * 0.25);
  const pnl = r.nav - STARTING_CAPITAL;
  const pct = (pnl / STARTING_CAPITAL) * 100;
  const mUp = Number.isFinite(liq.marginUsedPercent) ? clampN(liq.marginUsedPercent, 0, 999) : 0;
  const cPct = r.nav > 0 ? (fund.cash / r.nav) * 100 : 0;
  return { nav: r.nav, unrealizedPnL: r.unrealizedPnL, grossExposure: e.grossExposure, netExposure: e.netExposure, leverage: leverage, marginUsedPercent: mUp, atRisk: liq.atRisk, riskPct: riskPct, riskLabel: riskLabel, liquidationAt: liqAt, cashPct: cPct, dailyPnl: pnl, dailyPnlPct: pct, availCash: avail, cash: fund.cash };
}
function initAll() {
  const m = createInitialMarket();
  const fund = createFund(STARTING_CAPITAL, 0);
  const ph: Record<Ticker, number[]> = {};
  for (const t of Object.keys(m.companies)) ph[t] = [m.companies[t].price];
  return { m: m, fund: fund, ph: ph };
}
const _i = initAll();
const _d = derive(_i.m, _i.fund);
function applyDerived(set: (p: Partial<GameStore>) => void, s: GameStore, nf: Fund) {
  const d = derive({ companies: s.companies }, nf);
  const hf = { ...nf, history: [...nf.history, { timestamp: s.timestamp, nav: d.nav }] };
  set({
    companies: s.companies,
    fund: hf,
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
    peakNav: peakNav(hf),
  });
}
export const useGameStore = create<GameStore>()((set, get) => ({
  companies: _i.m.companies, tickCount: 0, timestamp: 0, fund: _i.fund,
  events: seedEvents(), priceHistory: _i.ph, navHistory: [STARTING_CAPITAL],
  rivalNav: STARTING_CAPITAL, rivalHistory: [STARTING_CAPITAL], selectedTicker: 'NOVA',
  scheduler: initialScheduler(15),
  nav: _d.nav, cash: _d.cash, availCash: _d.availCash, unrealizedPnL: _d.unrealizedPnL,
  dailyPnl: _d.dailyPnl, dailyPnlPct: _d.dailyPnlPct, grossExposure: _d.grossExposure,
  netExposure: _d.netExposure, leverage: _d.leverage, marginUsedPercent: _d.marginUsedPercent,
  atRisk: _d.atRisk, riskPct: _d.riskPct, riskLabel: _d.riskLabel, cashPct: _d.cashPct,
  liquidationAt: _d.liquidationAt,
  liquidated: false, causeOfDeath: '', peakNav: STARTING_CAPITAL,
  tick: () => {
    const s = get();
    if (s.liquidated) return;
    const prev = { companies: s.companies, tickCount: s.tickCount, timestamp: s.timestamp };
    let next = tickMarket(prev);
    const rng = mulberry32((0x51ab ^ Math.imul(next.tickCount + 1, 0x85ebca6b)) >>> 0);
    const scripted = maybeFireScriptedEvent(next, s.scheduler, rng);
    let evt: MarketEvent | null = null;
    if (scripted.event) {
      evt = scripted.event;
      next = applyEvent(next, evt) as typeof next;
    } else {
      evt = generateEvent(next, rng);
      if (evt) next = applyEvent(next, evt) as typeof next;
    }
    const rr = mulberry32((0x77aa ^ Math.imul(next.tickCount + 1, 0x27d4eb2f)) >>> 0);
    const rivalNav = Math.max(1, s.rivalNav * (1 + (rr() - 0.52) * 0.012));
    const d = derive(next, s.fund);
    const fundWithHistory = { ...s.fund, history: [...s.fund.history, { timestamp: next.timestamp, nav: d.nav }] };
    const ph: Record<Ticker, number[]> = { ...s.priceHistory };
    for (const t of Object.keys(next.companies)) { const a = [...(ph[t] ?? []), next.companies[t].price]; ph[t] = a.length > CAP ? a.slice(a.length - CAP) : a; }
    if (d.atRisk) {
      const closedFund = liquidateFund(fundWithHistory, next);
      const ld = derive(next, closedFund);
      set({ companies: next.companies, tickCount: next.tickCount, timestamp: next.timestamp, scheduler: scripted.next, rivalNav: rivalNav, rivalHistory: [...s.rivalHistory, rivalNav].slice(-CAP), navHistory: [...s.navHistory, ld.nav].slice(-CAP), priceHistory: ph, events: evt ? [evt, ...s.events].slice(0, 60) : s.events, nav: ld.nav, cash: ld.cash, availCash: ld.availCash, unrealizedPnL: ld.unrealizedPnL, dailyPnl: ld.dailyPnl, dailyPnlPct: ld.dailyPnlPct, grossExposure: ld.grossExposure, netExposure: ld.netExposure, leverage: ld.leverage, marginUsedPercent: ld.marginUsedPercent, atRisk: ld.atRisk, riskPct: ld.riskPct, riskLabel: ld.riskLabel, cashPct: ld.cashPct, liquidationAt: ld.liquidationAt, fund: closedFund, liquidated: true, causeOfDeath: deriveCauseOfDeath(fundWithHistory, next), peakNav: peakNav(fundWithHistory) });
      return;
    }
    set({ companies: next.companies, tickCount: next.tickCount, timestamp: next.timestamp, scheduler: scripted.next, rivalNav: rivalNav, rivalHistory: [...s.rivalHistory, rivalNav].slice(-CAP), navHistory: [...s.navHistory, d.nav].slice(-CAP), priceHistory: ph, events: evt ? [evt, ...s.events].slice(0, 60) : s.events, nav: d.nav, cash: d.cash, availCash: d.availCash, unrealizedPnL: d.unrealizedPnL, dailyPnl: d.dailyPnl, dailyPnlPct: d.dailyPnlPct, grossExposure: d.grossExposure, netExposure: d.netExposure, leverage: d.leverage, marginUsedPercent: d.marginUsedPercent, atRisk: d.atRisk, riskPct: d.riskPct, riskLabel: d.riskLabel, cashPct: d.cashPct, liquidationAt: d.liquidationAt, fund: fundWithHistory, liquidated: false, causeOfDeath: '', peakNav: peakNav(fundWithHistory) });
  },
  buy: (ticker, dollarAmount, leverage) => {
    const s = get();
    const price = s.companies[ticker]?.price;
    if (!price || price <= 0) return;
    const lv = Math.max(1, Math.floor(leverage ?? 1));
    const notional = Math.floor(dollarAmount) * lv;
    if (notional <= 0) return;
    const nf = engOpen(s.fund, ticker, 'long', notional, price);
    if (nf === s.fund) return;
    applyDerived(set, s, nf);
  },
  short: (ticker, dollarAmount, leverage) => {
    const s = get();
    const price = s.companies[ticker]?.price;
    if (!price || price <= 0) return;
    const lv = Math.max(1, Math.floor(leverage ?? 1));
    const notional = Math.floor(dollarAmount) * lv;
    if (notional <= 0) return;
    const nf = engOpen(s.fund, ticker, 'short', notional, price);
    if (nf === s.fund) return;
    applyDerived(set, s, nf);
  },
  closePosition: (id) => {
    const s = get();
    const pos = s.fund.positions.find((pp) => pp.id === id);
    if (!pos) return;
    const price = s.companies[pos.ticker]?.price;
    if (!price || price <= 0) return;
    const nf = engClose(s.fund, id, price);
    if (nf === s.fund) return;
    applyDerived(set, s, nf);
  },
  selectTicker: (t) => set({ selectedTicker: t }),
  restart: () => {
    const nm = createInitialMarket();
    const nf = createFund(STARTING_CAPITAL, 0);
    const nd = derive(nm, nf);
    const nph: Record<Ticker, number[]> = {};
    for (const t of Object.keys(nm.companies)) nph[t] = [nm.companies[t].price];
    set({ companies: nm.companies, tickCount: 0, timestamp: 0, fund: nf, events: seedEvents(), priceHistory: nph, navHistory: [STARTING_CAPITAL], rivalNav: STARTING_CAPITAL, rivalHistory: [STARTING_CAPITAL], selectedTicker: 'NOVA', scheduler: initialScheduler(15), nav: nd.nav, cash: nd.cash, availCash: nd.availCash, unrealizedPnL: nd.unrealizedPnL, dailyPnl: nd.dailyPnl, dailyPnlPct: nd.dailyPnlPct, grossExposure: nd.grossExposure, netExposure: nd.netExposure, leverage: nd.leverage, marginUsedPercent: nd.marginUsedPercent, atRisk: nd.atRisk, riskPct: nd.riskPct, riskLabel: nd.riskLabel, cashPct: nd.cashPct, liquidationAt: nd.liquidationAt, liquidated: false, causeOfDeath: '', peakNav: STARTING_CAPITAL });
  },
}));
