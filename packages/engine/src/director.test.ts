import { describe, expect, it } from 'vitest';
import {
  buildDirectorEvent,
  DIRECTOR_INTERVENTIONS,
  observeWorld,
  ruleDirector,
  validateIntervention,
  type DirectorObservation,
} from './director';
import { createInitialMarket, mulberry32 } from './market';
import { DIRECTOR_COOLDOWN_TICKS, DIRECTOR_QUIET_TICKS } from '../../../config/game';

function obs(over: Partial<DirectorObservation> = {}): DirectorObservation {
  return {
    tickCount: 200,
    ticksSinceLastEvent: DIRECTOR_QUIET_TICKS + 5,
    ticksSinceLastIntervention: null,
    eventFiredThisTick: false,
    avgAbsChangePct: 0.002,
    marketChangePct: 0.001,
    sectors: ['tech', 'energy', 'finance'],
    fundsAlive: 3,
    fundsTotal: 3,
    ...over,
  };
}

describe('observeWorld', () => {
  it('summarises only public conditions', () => {
    const m = createInitialMarket();
    m.tickCount = 50;
    m.companies.NOVA = { ...m.companies.NOVA, price: m.companies.NOVA.previousClose * 1.1 };
    const o = observeWorld({ market: m, lastEventTick: 40, lastInterventionTick: null, eventFiredThisTick: false, fundsAlive: 2, fundsTotal: 3 });
    expect(o.ticksSinceLastEvent).toBe(10);
    expect(o.ticksSinceLastIntervention).toBeNull();
    expect(o.avgAbsChangePct).toBeCloseTo(0.1 / Object.keys(m.companies).length, 10);
    expect(new Set(o.sectors)).toEqual(new Set(Object.values(m.companies).map((c) => c.sector)));
    expect(Object.keys(o).sort()).toEqual(
      ['avgAbsChangePct', 'eventFiredThisTick', 'fundsAlive', 'fundsTotal', 'marketChangePct', 'sectors', 'tickCount', 'ticksSinceLastEvent', 'ticksSinceLastIntervention'].sort(),
    );
  });
});

describe('ruleDirector', () => {
  it('chooses no intervention when an event fired this tick, in cooldown, or when the market is stressed', () => {
    expect(ruleDirector(obs({ eventFiredThisTick: true })).intervention).toEqual({ kind: 'none' });
    expect(ruleDirector(obs({ ticksSinceLastIntervention: DIRECTOR_COOLDOWN_TICKS - 1 })).intervention).toEqual({ kind: 'none' });
    expect(ruleDirector(obs({ avgAbsChangePct: 0.2 })).intervention).toEqual({ kind: 'none' });
  });

  it('chooses no intervention when events are recent', () => {
    expect(ruleDirector(obs({ ticksSinceLastEvent: 1 })).intervention).toEqual({ kind: 'none' });
  });

  it('challenges a quiet, calm market with a valid catalog intervention and explains why', () => {
    const d = ruleDirector(obs());
    expect(d.intervention.kind).not.toBe('none');
    expect(validateIntervention(d.intervention, obs())).toEqual(d.intervention);
    expect(d.rationale.length).toBeGreaterThan(10);
  });

  it('tightens a quiet market that has run up', () => {
    // Every company up ~3%: mean |change| equals the mean change, as it must in a broad run-up.
    expect(ruleDirector(obs({ avgAbsChangePct: 0.03, marketChangePct: 0.03 })).intervention).toEqual({ kind: 'macro_tightening' });
  });

  it('varies its choice over time', () => {
    const kinds = new Set([200, 210, 220, 230, 240, 250].map((t) => JSON.stringify(ruleDirector(obs({ tickCount: t })).intervention)));
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('validateIntervention', () => {
  it('rejects unknown kinds, sectors not listed, and anything during cooldown or after an event this tick', () => {
    expect(validateIntervention({ kind: 'pump_nova' }, obs())).toEqual({ kind: 'none' });
    expect(validateIntervention({ kind: 'sector_shock', sector: 'space' }, obs())).toEqual({ kind: 'none' });
    expect(validateIntervention({ kind: 'sector_shock' }, obs())).toEqual({ kind: 'none' });
    expect(validateIntervention({ kind: 'macro_easing' }, obs({ eventFiredThisTick: true }))).toEqual({ kind: 'none' });
    expect(validateIntervention({ kind: 'macro_easing' }, obs({ ticksSinceLastIntervention: 1 }))).toEqual({ kind: 'none' });
    expect(validateIntervention(null, obs())).toEqual({ kind: 'none' });
    expect(validateIntervention({ kind: 'sector_boom', sector: 'tech' }, obs())).toEqual({ kind: 'sector_boom', sector: 'tech' });
  });

  it('the catalog never names a ticker', () => {
    expect(DIRECTOR_INTERVENTIONS).toEqual(['none', 'macro_tightening', 'macro_easing', 'sector_shock', 'sector_boom']);
  });
});

describe('buildDirectorEvent', () => {
  const m = createInitialMarket();
  m.tickCount = 99;
  const rng = mulberry32(7);

  it('builds sector and macro events with bounded, signed impacts and no ticker', () => {
    const shock = buildDirectorEvent({ kind: 'sector_shock', sector: 'tech' }, m, rng)!;
    expect(shock).toMatchObject({ type: 'sector', sector: 'tech' });
    expect(shock.ticker).toBeUndefined();
    expect(shock.priceImpactPercent).toBeLessThan(0);
    expect(Math.abs(shock.priceImpactPercent)).toBeLessThanOrEqual(8);
    const boom = buildDirectorEvent({ kind: 'sector_boom', sector: 'energy' }, m, rng)!;
    expect(boom.priceImpactPercent).toBeGreaterThan(0);
    const tight = buildDirectorEvent({ kind: 'macro_tightening' }, m, rng)!;
    expect(tight.type).toBe('macro');
    expect(tight.priceImpactPercent).toBeLessThan(0);
    expect(buildDirectorEvent({ kind: 'macro_easing' }, m, rng)!.priceImpactPercent).toBeGreaterThan(0);
    expect(buildDirectorEvent({ kind: 'none' }, m, rng)).toBeNull();
    expect(shock.id).toMatch(/^director-/);
  });
});
