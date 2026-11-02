import { describe, expect, it } from 'vitest';
import { checkLabToken, parseExperimentRequest, runExperimentSpec } from './labCore';

const ALL = ['sterling-vale', 'halden-whitmore', 'crown-meridian'];
const body = (over: Record<string, unknown> = {}) => ({
  name: 'Director on/off',
  variable: 'directorMode',
  values: ['none', 'rule'],
  base: { funds: ALL, directorMode: 'rule', decisionEveryTicks: null, ticks: 200 },
  seeds: [1, 2, 3],
  ...over,
});

describe('parseExperimentRequest', () => {
  it('accepts a valid one-variable experiment', () => {
    const r = parseExperimentRequest(body());
    expect(r).toEqual({ ok: true, spec: body() });
  });

  it('accepts each variable with valid values and trims the name', () => {
    expect(parseExperimentRequest(body({ variable: 'funds', values: [['crown-meridian'], ALL] })).ok).toBe(true);
    expect(parseExperimentRequest(body({ variable: 'decisionEveryTicks', values: [null, 5, 30] })).ok).toBe(true);
    const r = parseExperimentRequest(body({ name: '  spaced  ' }));
    expect(r.ok && r.spec.name).toBe('spaced');
  });

  it.each([
    ['not an object', null],
    ['empty name', body({ name: ' ' })],
    ['long name', body({ name: 'x'.repeat(81) })],
    ['unknown variable', body({ variable: 'model' })],
    ['one value', body({ values: ['rule'] })],
    ['duplicate values only', body({ values: ['rule', 'rule'] })],
    ['too many arms', body({ variable: 'decisionEveryTicks', values: [1, 2, 3, 4, 5, 6, 7] })],
    ['bad director value', body({ values: ['none', 'jev'] })],
    ['unknown fund key', body({ variable: 'funds', values: [['apex-capital'], ALL] })],
    ['empty fund set', body({ variable: 'funds', values: [[], ALL] })],
    ['duplicate fund in a set', body({ variable: 'funds', values: [['crown-meridian', 'crown-meridian'], ALL] })],
    ['cadence out of range', body({ variable: 'decisionEveryTicks', values: [0, 10] })],
    ['fractional cadence', body({ variable: 'decisionEveryTicks', values: [2.5, 10] })],
    ['huge ticks', body({ base: { funds: ALL, directorMode: 'rule', decisionEveryTicks: null, ticks: 1e9 } })],
    ['too few ticks', body({ base: { funds: ALL, directorMode: 'rule', decisionEveryTicks: null, ticks: 5 } })],
    ['missing base', body({ base: undefined })],
    ['too many seeds', body({ seeds: Array.from({ length: 11 }, (_, i) => i) })],
    ['no seeds', body({ seeds: [] })],
    ['duplicate seeds', body({ seeds: [1, 1] })],
    ['negative seed', body({ seeds: [-1] })],
    ['non-integer seed', body({ seeds: [1.5] })],
  ])('rejects %s', (_label, input) => {
    const r = parseExperimentRequest(input);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.length).toBeGreaterThan(5);
  });
});

describe('checkLabToken', () => {
  it('is disabled without a configured token, and only an exact bearer passes', () => {
    expect(checkLabToken('Bearer s3cret', undefined)).toBe('disabled');
    expect(checkLabToken('Bearer s3cret', '')).toBe('disabled');
    expect(checkLabToken(undefined, 's3cret')).toBe('unauthorized');
    expect(checkLabToken('s3cret', 's3cret')).toBe('unauthorized');
    expect(checkLabToken('Bearer s3cre', 's3cret')).toBe('unauthorized');
    expect(checkLabToken('Bearer s3cret-longer', 's3cret')).toBe('unauthorized');
    expect(checkLabToken('Bearer s3cret', 's3cret')).toBe('ok');
  });
});

describe('runExperimentSpec', () => {
  it('runs every arm on every seed, yielding between runs, and returns paired comparisons and series', async () => {
    let yields = 0;
    const parsed = parseExperimentRequest(body({ seeds: [1, 2] }));
    if (!parsed.ok) throw new Error(parsed.error);
    const r = await runExperimentSpec(parsed.spec, async () => {
      yields++;
    });
    expect(yields).toBe(4);
    expect(r.arms.map((a) => a.label)).toEqual(['directorMode=none', 'directorMode=rule']);
    expect(r.arms[0].funds.map((f) => f.n)).toEqual([2, 2, 2]);
    expect(r.runs.map((a) => a.runs.map((x) => x.seed))).toEqual([[1, 2], [1, 2]]);
    expect(r.series[0].funds[0].navs.length).toBeGreaterThan(10);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
});
