import type { MarketEvent, MarketState } from './types';
export interface ScriptedTemplate { id: string; kind: string; weight: number; }
export const SCRIPTED_TEMPLATES: ScriptedTemplate[] = [
  { id: 'nova-breakthrough', kind: 'company', weight: 3 },
  { id: 'titan-recall', kind: 'company', weight: 3 },
  { id: 'orbl-failure', kind: 'company', weight: 3 },
  { id: 'orbl-success', kind: 'company', weight: 1 },
  { id: 'fed-hike', kind: 'macro', weight: 2 },
  { id: 'helix-trial', kind: 'company', weight: 2 },
];
export interface SchedulerState { nextFireTick: number; lastTicker: string | null; }
export function initialScheduler(nextFireTick = 15): SchedulerState {
  return { nextFireTick: nextFireTick, lastTicker: null };
}
export function nextFireDelay(rng: () => number): number {
  return 15 + Math.floor(rng() * 6);
}
function range(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}
export function buildScriptedEvent(templateId: string, tickCount: number, timestamp: number, rng: () => number): MarketEvent {
  const tag = Math.floor(rng() * 1e6);
  if (templateId === 'nova-breakthrough') {
    const shock = range(rng, 18, 25);
    return { id: `script-nova-${tickCount}-${tag}`, type: 'company', ticker: 'NOVA', headline: 'Nova AI announces breakthrough model with 4x inference gains', priceImpactPercent: Number(shock.toFixed(2)), timestamp: timestamp };
  }
  if (templateId === 'titan-recall') {
    const shock = range(rng, 15, 22);
    return { id: `script-titan-${tickCount}-${tag}`, type: 'company', ticker: 'TITAN', headline: 'Titan Motors recalls 300,000 vehicles over battery fault', priceImpactPercent: Number((-shock).toFixed(2)), timestamp: timestamp };
  }
  if (templateId === 'orbl-failure') {
    const shock = range(rng, 30, 40);
    return { id: `script-orbl-fail-${tickCount}-${tag}`, type: 'company', ticker: 'ORBL', headline: 'Orbital launch failure destroys payload, grounds fleet', priceImpactPercent: Number((-shock).toFixed(2)), timestamp: timestamp };
  }
  if (templateId === 'orbl-success') {
    const shock = range(rng, 25, 35);
    return { id: `script-orbl-ok-${tickCount}-${tag}`, type: 'company', ticker: 'ORBL', headline: 'Orbital nails reusable launch, lands $4B NASA contract', priceImpactPercent: Number(shock.toFixed(2)), timestamp: timestamp };
  }
  if (templateId === 'fed-hike') {
    const shock = range(rng, 6, 9);
    return { id: `script-fed-${tickCount}-${tag}`, type: 'macro', headline: 'Fed raises interest rates, bank stocks lead selloff', priceImpactPercent: Number((-shock).toFixed(2)), timestamp: timestamp };
  }
  const good = rng() < 0.5;
  const shock = good ? 60 : -40;
  return { id: `script-helix-${tickCount}-${tag}`, type: 'company', ticker: 'HELX', headline: good ? 'Helix Systems trial succeeds, FDA breakthrough tag granted' : 'Helix Systems trial fails primary endpoint', priceImpactPercent: shock, timestamp: timestamp };
}

export function templateTicker(templateId: string): string | null {
  if (templateId === 'nova-breakthrough') return 'NOVA';
  if (templateId === 'titan-recall') return 'TITAN';
  if (templateId === 'orbl-failure') return 'ORBL';
  if (templateId === 'orbl-success') return 'ORBL';
  if (templateId === 'helix-trial') return 'HELX';
  return null;
}
export function pickTemplate(rng: () => number, excludeTicker: string | null): string {
  const pool = SCRIPTED_TEMPLATES.filter((t) => templateTicker(t.id) !== excludeTicker);
  const list = pool.length > 0 ? pool : SCRIPTED_TEMPLATES;
  let total = 0;
  for (const t of list) total += t.weight;
  let roll = rng() * total;
  for (const t of list) { roll -= t.weight; if (roll <= 0) return t.id; }
  return list[list.length - 1].id;
}
export function maybeFireScriptedEvent(state: MarketState, sched: SchedulerState, rng: () => number): { event: MarketEvent | null; next: SchedulerState } {
  if (state.tickCount < sched.nextFireTick) return { event: null, next: sched };
  const templateId = pickTemplate(rng, sched.lastTicker);
  const event = buildScriptedEvent(templateId, state.tickCount, state.timestamp, rng);
  return { event: event, next: { nextFireTick: state.tickCount + nextFireDelay(rng), lastTicker: templateTicker(templateId) } };
}
const POS = ['announces new model with 2x performance gains', 'beats Q3 results', 'wins $2.1B government contract', 'app reaches 100M MAU milestone', 'raises full-year guidance', 'signs major partnership'];
const NEG = ['faces regulatory review', 'CFO to step down next quarter', 'cuts guidance on supply pressure', 'misses revenue estimates', 'downgraded on valuation', 'halts production after incident'];
export function generateEvent(state: MarketState, rng: () => number): MarketEvent | null {
  if (rng() > 0.14) return null;
  const tickers = Object.keys(state.companies);
  if (tickers.length === 0) return null;
  const ticker = tickers[Math.floor(rng() * tickers.length)];
  const company = state.companies[ticker];
  const positive = rng() > 0.45;
  const pool = positive ? POS : NEG;
  const tail = pool[Math.floor(rng() * pool.length)];
  const magnitude = (0.5 + rng() * 1.0) * company.volatility * 100 * 2;
  return { id: `evt-${state.tickCount}-${ticker}-${Math.floor(rng() * 1e6)}`, type: 'company', ticker: ticker, headline: `${company.name} ${tail}`, priceImpactPercent: Number(((positive ? 1 : -1) * magnitude).toFixed(2)), timestamp: state.timestamp };
}