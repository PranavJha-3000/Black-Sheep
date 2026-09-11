import { describe, expect, it } from 'vitest';
import { applyEvent, createInitialMarket, mulberry32, tickMarket } from './engine/market';
import { buildScriptedEvent, maybeFireScriptedEvent, initialScheduler, pickTemplate } from './engine/events';
import type { MarketEvent, MarketState } from './engine/types';
function runTicks(s: MarketState, seed: number, n: number): MarketState { let x = s; for (let i = 0; i < n; i++) x = tickMarket(x, seed); return x; }
describe('market engine', () => {
  const market = createInitialMarket();
  it('seeds 6 companies with realistic prices', () => {
    expect(Object.keys(market.companies)).toEqual(['NOVA', 'TITAN', 'ORBL', 'HELX', 'APXB', 'PULSE']);
    for (const t of Object.keys(market.companies)) { const c = market.companies[t]; expect(c.price).toBeGreaterThanOrEqual(20); expect(c.price).toBeLessThanOrEqual(400); expect(c.volatility).toBeGreaterThan(0); expect(c.previousClose).toBe(c.price); }
  });
  it('deterministic same seed', () => { const a = runTicks(market, 42, 100); const b = runTicks(market, 42, 100); expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(a.tickCount).toBe(100); });
  it('mulberry32 deterministic', () => { const r1 = mulberry32(7); const r2 = mulberry32(7); expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]); });
  it('prices never negative over 10000 ticks', () => { const s = runTicks(market, 12345, 10000); for (const t of Object.keys(s.companies)) expect(s.companies[t].price).toBeGreaterThan(0); });
  it('vol ordering', () => {
    const hlx = avgPct(market, 2024, 1000, 'HELX'); const orbl = avgPct(market, 2024, 1000, 'ORBL'); const nova = avgPct(market, 2024, 1000, 'NOVA'); const tit = avgPct(market, 2024, 1000, 'TITAN'); const apxb = avgPct(market, 2024, 1000, 'APXB'); const pul = avgPct(market, 2024, 1000, 'PULSE');
    expect(hlx).toBeGreaterThan(orbl); expect(orbl).toBeGreaterThan(nova); expect(nova).toBeGreaterThan(tit); expect(tit).toBeGreaterThan(apxb); expect(apxb).toBeGreaterThan(pul); expect(hlx).toBeGreaterThan(pul * 3);
  });
  it('applyEvent shocks single company', () => {
    const before = market.companies.NOVA.price;
    const ev: MarketEvent = { id: 'e1', type: 'company', ticker: 'NOVA', headline: 'x', priceImpactPercent: 10, timestamp: 0 };
    const after = applyEvent(market, ev);
    expect(after.companies.NOVA.price).toBeCloseTo(before * 1.1, 6); expect(after.companies.APXB.price).toBe(market.companies.APXB.price);
  });
  it('macro scales by rateSensitivity', () => {
    const ev: MarketEvent = { id: 'e2', type: 'macro', headline: 'Fed', priceImpactPercent: -5, timestamp: 0 };
    const after = applyEvent(market, ev);
    const pm = Math.abs(after.companies.PULSE.price / market.companies.PULSE.price - 1);
    const am = Math.abs(after.companies.APXB.price / market.companies.APXB.price - 1);
    expect(am).toBeGreaterThan(pm);
  });
  it('sector event', () => {
    const ev: MarketEvent = { id: 'e3', type: 'sector', sector: 'finance', headline: 'Banks', priceImpactPercent: 3, timestamp: 0 };
    const after = applyEvent(market, ev);
    expect(after.companies.APXB.price).toBeCloseTo(market.companies.APXB.price * 1.03, 6); expect(after.companies.NOVA.price).toBe(market.companies.NOVA.price);
  });
  it('scripted shocks land in their advertised ranges', () => {
    const rng = mulberry32(99);
    const nova = buildScriptedEvent('nova-breakthrough', 10, 10, rng);
    expect(nova.ticker).toBe('NOVA'); expect(nova.priceImpactPercent).toBeGreaterThanOrEqual(18); expect(nova.priceImpactPercent).toBeLessThanOrEqual(25);
    const titan = buildScriptedEvent('titan-recall', 10, 10, rng);
    expect(titan.priceImpactPercent).toBeLessThanOrEqual(-15); expect(titan.priceImpactPercent).toBeGreaterThanOrEqual(-22);
    const fail = buildScriptedEvent('orbl-failure', 10, 10, rng);
    expect(fail.priceImpactPercent).toBeLessThanOrEqual(-30); expect(fail.priceImpactPercent).toBeGreaterThanOrEqual(-40);
    const fed = buildScriptedEvent('fed-hike', 10, 10, rng);
    expect(fed.type).toBe('macro'); expect(fed.priceImpactPercent).toBeLessThanOrEqual(-6); expect(fed.priceImpactPercent).toBeGreaterThanOrEqual(-9);
  });
  it('helix trial is a 50/50 binary: -40 or +60', () => {
    let up = 0; let down = 0;
    for (let i = 0; i < 400; i++) {
      const e = buildScriptedEvent('helix-trial', i, i, mulberry32(i + 7));
      expect([60, -40]).toContain(e.priceImpactPercent);
      if (e.priceImpactPercent === 60) up++; else down++;
    }
    expect(up).toBeGreaterThan(120); expect(down).toBeGreaterThan(120);
  });
  it('scheduler fires every 15-20 ticks with no same-company repeat', () => {
    const m = createInitialMarket();
    let sched = initialScheduler(15);
    let last: string | null = null;
    const firedAt: number[] = [];
    for (let t = 0; t < 120; t++) {
      const st = { ...m, tickCount: t, timestamp: t };
      const r = maybeFireScriptedEvent(st, sched, mulberry32(t * 31 + 5));
      sched = r.next;
      if (r.event) {
        firedAt.push(t);
        const tag = r.event.ticker ?? 'MACRO';
        expect(tag).not.toBe(last);
        last = tag === 'MACRO' ? null : tag;
      }
    }
    expect(firedAt.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < firedAt.length; i++) {
      const gap = firedAt[i] - firedAt[i - 1];
      expect(gap).toBeGreaterThanOrEqual(15); expect(gap).toBeLessThanOrEqual(20);
    }
    expect(pickTemplate(mulberry32(1), 'NOVA')).not.toBe('nova-breakthrough');
  });
});
function avgPct(s: MarketState, seed: number, n: number, t: string): number { let x = s; let tot = 0; let prev = x.companies[t].price; for (let i = 0; i < n; i++) { x = tickMarket(x, seed); const p = x.companies[t].price; tot += Math.abs(p / prev - 1); prev = p; } return (tot / n) * 100; }
