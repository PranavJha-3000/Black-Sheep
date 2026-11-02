import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  compareArms,
  downsample,
  expandArms,
  experimentManifest,
  fnv1a,
  initialSimState,
  simulateWorld,
  stepWorld,
  type ArmConfig,
  type ExperimentSpec,
  type RunResult,
} from './experiment';
import { openPosition } from './portfolio';
import { STARTING_CAPITAL } from '../../../config/game';

const ALL = ['sterling-vale', 'halden-whitmore', 'crown-meridian'];
const base: ArmConfig = { funds: ALL, directorMode: 'rule', decisionEveryTicks: null, ticks: 300 };

describe('simulateWorld', () => {
  it('is reproducible: the same arm and seed give the same digest and series', () => {
    const a = simulateWorld(base, 42);
    const b = simulateWorld(base, 42);
    expect(a.digest).toBe(b.digest);
    expect(a.funds.map((f) => f.navs)).toEqual(b.funds.map((f) => f.navs));
    expect(a.funds.map((f) => f.decisions)).toEqual(b.funds.map((f) => f.decisions));
  });

  it('different seeds give different worlds', () => {
    expect(simulateWorld(base, 1).digest).not.toBe(simulateWorld(base, 2).digest);
  });

  it('records a NAV every snapshot tick, decisions on each fund slot, and trades', () => {
    const r = simulateWorld(base, 7);
    expect(r.funds.map((f) => f.key)).toEqual(ALL);
    for (const f of r.funds) {
      expect(f.navs.length).toBe(Math.floor(300 / 3));
      // Slots 0/3/6 every 10 ticks, skipping tick 0: ~30 decisions over 300 ticks,
      // or one per slot until the fund is liquidated.
      const lastTick = f.liquidatedAtTick ?? 300;
      expect(f.decisions).toBeGreaterThanOrEqual(Math.floor(lastTick / 10) - 1);
      expect(f.decisions).toBeLessThanOrEqual(Math.ceil(lastTick / 10));
      expect(f.trades).toBeLessThanOrEqual(f.decisions);
    }
  });

  it("the Director only intervenes in 'rule' mode", () => {
    const quiet = simulateWorld({ ...base, ticks: 2000, directorMode: 'none' }, 3);
    expect(quiet.directorInterventions).toBe(0);
    expect(quiet.events.some((e) => e.director)).toBe(false);
    const ruled = simulateWorld({ ...base, ticks: 2000, directorMode: 'rule' }, 3);
    expect(ruled.events.filter((e) => e.director).length).toBe(ruled.directorInterventions);
    // Calibrated to this world's event density (D-029 revisit): the rule Director does act.
    expect(ruled.directorInterventions).toBeGreaterThan(0);
  });

  it('runs a single-fund world and honours a cadence override', () => {
    const r = simulateWorld({ ...base, funds: ['crown-meridian'], decisionEveryTicks: 30 }, 5);
    expect(r.funds).toHaveLength(1);
    expect(r.funds[0].decisions).toBeLessThanOrEqual(10);
  });
});

describe('stepWorld liquidation', () => {
  it('liquidates an under-margined fund, which then never decides again and keeps its NAV', () => {
    const s = initialSimState({ ...base, funds: ['halden-whitmore'] }, 9);
    // The largest short margin allows; a 60% squeeze then breaches maintenance margin.
    const company = s.market.companies.NOVA;
    const shorted = openPosition(s.funds[0].fund, 'NOVA', 'short', 1.9 * STARTING_CAPITAL, company.price);
    expect(shorted.positions).toHaveLength(1);
    s.funds[0].fund = { ...s.funds[0].fund, ...shorted };
    s.market = { ...s.market, companies: { ...s.market.companies, NOVA: { ...company, price: company.price * 1.6, previousClose: company.price * 1.6 } } };
    stepWorld(s);
    expect(s.funds[0].liquidated).toBe(true);
    expect(s.funds[0].fund.positions).toHaveLength(0);
    const decided = s.funds[0].decisions;
    for (let i = 0; i < 30; i++) stepWorld(s);
    expect(s.funds[0].decisions).toBe(decided);
  });
});

describe('expandArms', () => {
  it('builds one arm per value and varies only that variable', () => {
    const spec: ExperimentSpec = { name: 'dir', base, variable: 'directorMode', values: ['none', 'rule'], seeds: [1, 2] };
    const arms = expandArms(spec);
    expect(arms.map((a) => a.config.directorMode)).toEqual(['none', 'rule']);
    expect(arms.map((a) => a.label)).toEqual(['directorMode=none', 'directorMode=rule']);
    expect({ ...arms[0].config, directorMode: 'rule' }).toEqual(arms[1].config);
  });
});

describe('hashing and manifest', () => {
  it('canonicalJson ignores key order; fnv1a is 8 hex chars and stable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 0, f: 1 }], d: 2 }, b: 1 }));
    expect(fnv1a('black sheep')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('black sheep')).toBe(fnv1a('black sheep'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });

  it('the manifest records seeds, config and profile hashes and says it is policy-only', () => {
    const spec: ExperimentSpec = { name: 'dir', base, variable: 'directorMode', values: ['none', 'rule'], seeds: [1, 2] };
    const m = experimentManifest(spec);
    expect(m).toMatchObject({ seeds: [1, 2], policyOnly: true });
    expect(Object.keys(m.fundProfileHashes)).toEqual(ALL);
    expect(m.configHash).toBe(experimentManifest({ ...spec }).configHash);
    expect(m.configHash).not.toBe(experimentManifest({ ...spec, seeds: [1, 3] }).configHash);
  });
});

function run(seed: number, navEnd: Record<string, number>, liquidated: string[] = []): RunResult {
  return {
    seed,
    funds: Object.entries(navEnd).map(([key, end]) => ({
      key, name: key.toUpperCase(), navs: [100, end], liquidated: liquidated.includes(key), liquidatedAtTick: null, decisions: 1, trades: 1,
    })),
    events: [], directorInterventions: seed % 2, digest: 'x',
  };
}

describe('compareArms', () => {
  it('reports n, mean and sample std across seeds, survival, and paired differences vs the first arm', () => {
    const arms = compareArms(
      [
        { label: 'A', runs: [run(1, { f: 110 }), run(2, { f: 100 })] },
        { label: 'B', runs: [run(1, { f: 120 }), run(2, { f: 90 }, ['f'])] },
      ],
      100,
    );
    const a = arms[0].funds[0];
    expect(a).toMatchObject({ key: 'f', n: 2, survival: 1 });
    expect(a.totalReturn.mean).toBeCloseTo(0.05, 10);
    expect(a.totalReturn.std).toBeCloseTo(Math.sqrt(0.005), 10);
    expect(a.vsBaseline).toBeNull();
    expect(a.baselineLabel).toBeNull();
    const b = arms[1].funds[0];
    expect(b.survival).toBe(0.5);
    // Seed 1: +0.10, seed 2: -0.10 → mean 0; B beats A on one seed.
    expect(b.vsBaseline).toEqual({ meanDiff: expect.closeTo(0, 10), wins: 1, pairs: 2 });
    expect(b.baselineLabel).toBe('A');
    expect(arms[1].meanDirectorInterventions).toBe(0.5);
  });

  it('a single seed has a null std, never NaN', () => {
    const [arm] = compareArms([{ label: 'A', runs: [run(1, { f: 110 })] }], 100);
    expect(arm.funds[0].totalReturn.std).toBeNull();
    expect(JSON.stringify(arm)).not.toMatch(/NaN|Infinity/);
  });
});

describe('downsample', () => {
  it('keeps at most n points including the first and last', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(xs, 200);
    expect(d.length).toBeLessThanOrEqual(200);
    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(999);
    expect(downsample([1, 2, 3], 200)).toEqual([1, 2, 3]);
  });
});

describe('same-tick decisions (review I-1)', () => {
  it('every fund deciding on a tick sees the pre-trade market, as in the live world', () => {
    // Cadence 3 puts all three funds on offset 0: they decide on the same ticks.
    const arm: ArmConfig = { ...base, decisionEveryTicks: 3 };
    const together = initialSimState(arm, 21);
    for (let i = 0; i < 3; i++) stepWorld(together);
    for (const key of ALL) {
      const alone = initialSimState({ ...arm, funds: [key] }, 21);
      for (let i = 0; i < 3; i++) stepWorld(alone);
      // Tick 3 is the first decision tick, so before it the worlds are identical.
      const strip = (d: unknown) => {
        const { timestamp: _t, ...rest } = (d ?? {}) as Record<string, unknown>;
        return rest;
      };
      expect(strip(together.funds.find((f) => f.profile.key === key)!.fund.lastDecision)).toEqual(strip(alone.funds[0].fund.lastDecision));
    }
  });

  it('the order funds are listed in does not change the world', () => {
    const arm: ArmConfig = { ...base, decisionEveryTicks: 3, ticks: 400 };
    const a = simulateWorld(arm, 8);
    const b = simulateWorld({ ...arm, funds: [...ALL].reverse() }, 8);
    expect(a.digest).toBe(b.digest);
    for (const f of a.funds) expect(b.funds.find((x) => x.key === f.key)!.navs).toEqual(f.navs);
  });
});

describe('compareArms baselines (review I-3)', () => {
  it('pairs each fund with the first arm that contains it, so a mixed world is compared with each fund alone', () => {
    const arms = compareArms(
      [
        { label: 'funds=f', runs: [run(1, { f: 110 })] },
        { label: 'funds=g', runs: [run(1, { g: 90 })] },
        { label: 'funds=f+g', runs: [run(1, { f: 100, g: 100 })] },
      ],
      100,
    );
    expect(arms[0].funds[0]).toMatchObject({ vsBaseline: null, baselineLabel: null });
    expect(arms[1].funds[0]).toMatchObject({ vsBaseline: null, baselineLabel: null });
    const [f, g] = arms[2].funds;
    expect(f.baselineLabel).toBe('funds=f');
    expect(f.vsBaseline).toEqual({ meanDiff: expect.closeTo(-0.1, 10), wins: 0, pairs: 1 });
    expect(g.baselineLabel).toBe('funds=g');
    expect(g.vsBaseline).toEqual({ meanDiff: expect.closeTo(0.1, 10), wins: 1, pairs: 1 });
  });
});
