import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateExperimentCostUsd } from './labBrain';
import { checkStudyPlan } from './studyPlan';

const DIR = 'paper/study';
const studyFiles = () =>
  readdirSync(DIR).filter((f) => f.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((f) => ({ path: join(DIR, f), spec: JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

const spec = (over: Record<string, unknown> = {}) => ({
  name: 'study:H1:haiku:s1',
  variable: 'brains',
  values: [{}, { 'crown-meridian': 'claude-haiku-5-5' }],
  base: { funds: ['sterling-vale', 'halden-whitmore', 'crown-meridian'], directorMode: 'rule', decisionEveryTicks: 10, ticks: 500, brains: {}, memory: 'none' },
  seeds: [1, 2, 3, 4, 5],
  budgetUsd: 3,
  ...over,
});

describe('checkStudyPlan', () => {
  it('accepts the committed study files', () => {
    const files = studyFiles();
    expect(files.length).toBeGreaterThan(0);
    const r = checkStudyPlan(files, estimateExperimentCostUsd);
    if (!r.ok) throw new Error(r.error);
    expect(r.perFile.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(r.totalUsd).toBeCloseTo(r.perFile.reduce((s, f) => s + f.usd, 0), 9);
    for (const f of r.perFile) expect(f.usd).toBeLessThanOrEqual(25);
  });

  it('rejects a study file whose estimate exceeds the cap', () => {
    const r = checkStudyPlan([{ path: 'paper/study/big.json', spec: spec() }], () => 25.01);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('paper/study/big.json');
  });

  it('rejects a study file whose estimate exceeds its own budgetUsd', () => {
    const r = checkStudyPlan([{ path: 'a.json', spec: spec({ budgetUsd: 2 }) }], estimateExperimentCostUsd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('a.json');
  });

  it('rejects more than 10 seeds', () => {
    const r = checkStudyPlan([{ path: 'paper/study/seeds.json', spec: spec({ seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }) }], estimateExperimentCostUsd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('paper/study/seeds.json');
  });

  it('rejects duplicate experiment names across files', () => {
    const r = checkStudyPlan([{ path: 'a.json', spec: spec() }, { path: 'b.json', spec: spec({ seeds: [6] }) }], estimateExperimentCostUsd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('b.json');
  });

  it('rejects a brains study without the all-policy arm first', () => {
    const r = checkStudyPlan([{ path: 'a.json', spec: spec({ values: [{ 'crown-meridian': 'claude-haiku-5-5' }, {}] }) }], estimateExperimentCostUsd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('a.json');
  });
});
