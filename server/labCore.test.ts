import { describe, expect, it, vi } from 'vitest';
import { buildExperimentDetail, buildExperimentSummary, buildRunReplay, navTickAxis, checkLabToken, decisionFromRow, parseExperimentRequest, runExperimentSpec, type ExperimentRow } from './labCore';
import { downsample, simulateWorld } from '@black-sheep/engine/experiment';
import { EXPERIMENT_SERIES_POINTS, SNAPSHOT_EVERY_TICKS } from '../config/game';
import { BudgetExhausted } from './labBrain';
import { estimateCallCostUsd } from './budget';
import type { CreateMessage } from './providers/anthropic';
import { EXPERIMENT_REPLAY_MAX_DECISIONS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE, MAX_TOOL_ROUNDS } from '../config/game';

const ALL = ['sterling-vale', 'halden-whitmore', 'crown-meridian'];
const KEYED = { providerConfigured: true };
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
    const r = parseExperimentRequest(body(), KEYED);
    expect(r).toEqual({ ok: true, spec: body() });
  });

  it('accepts each variable with valid values and trims the name', () => {
    expect(parseExperimentRequest(body({ variable: 'funds', values: [['crown-meridian'], ALL] }), KEYED).ok).toBe(true);
    expect(parseExperimentRequest(body({ variable: 'decisionEveryTicks', values: [null, 5, 30] }), KEYED).ok).toBe(true);
    const r = parseExperimentRequest(body({ name: '  spaced  ' }), KEYED);
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
    const r = parseExperimentRequest(input, KEYED);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.length).toBeGreaterThan(5);
  });
});

describe('parseExperimentRequest: model brains and budget', () => {
  const brains = (over: Record<string, unknown> = {}) =>
    body({ variable: 'brains', values: [{}, { 'crown-meridian': 'claude-haiku-5-5' }], budgetUsd: 5, ...over });

  it('accepts a brains experiment with a budget', () => {
    const r = parseExperimentRequest(brains(), KEYED);
    expect(r.ok && r.spec).toMatchObject({ variable: 'brains', budgetUsd: 5, values: [{}, { 'crown-meridian': 'claude-haiku-5-5' }] });
  });

  it('rejects model brains without a provider', () => {
    expect(parseExperimentRequest(brains(), { providerConfigured: false })).toEqual({ ok: false, error: 'Model brains need a provider key on the server.' });
    // A model brain set on the base counts too.
    const viaBase = body({ base: { ...body().base, brains: { 'sterling-vale': 'claude-opus-5-5' } }, budgetUsd: 5 });
    expect(parseExperimentRequest(viaBase, { providerConfigured: false })).toEqual({ ok: false, error: 'Model brains need a provider key on the server.' });
  });

  it('requires budgetUsd for model brains', () => {
    const error = 'budgetUsd is required when any fund uses a model (max $25).';
    expect(parseExperimentRequest(brains({ budgetUsd: undefined }), KEYED)).toEqual({ ok: false, error });
    expect(parseExperimentRequest(brains({ budgetUsd: null }), KEYED)).toEqual({ ok: false, error });
  });

  it.each([0, -1, 25.01, Number.NaN, '5', Infinity])('rejects budgetUsd %s', (budgetUsd) => {
    expect(parseExperimentRequest(brains({ budgetUsd }), KEYED).ok).toBe(false);
    expect(parseExperimentRequest(body({ budgetUsd }), KEYED).ok).toBe(false);
  });

  it('rejects unknown model ids in brains', () => {
    expect(parseExperimentRequest(brains({ values: [{}, { 'crown-meridian': 'gpt-9' }] }), KEYED).ok).toBe(false);
    expect(parseExperimentRequest(brains({ values: [{}, { 'apex-capital': 'claude-haiku-5-5' }] }), KEYED).ok).toBe(false);
    expect(parseExperimentRequest(brains({ values: [{}, ['crown-meridian']] }), KEYED).ok).toBe(false);
    const badBase = body({ base: { ...body().base, brains: { 'crown-meridian': 'gpt-9' } } });
    expect(parseExperimentRequest(badBase, KEYED).ok).toBe(false);
  });

  it('policy-only spec needs no budget', () => {
    const r = parseExperimentRequest(body(), { providerConfigured: false });
    expect(r).toEqual({ ok: true, spec: body() });
    // An all-policy brains map is policy-only as well.
    expect(parseExperimentRequest(body({ base: { ...body().base, brains: { 'crown-meridian': 'policy' } } }), { providerConfigured: false }).ok).toBe(true);
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
    const parsed = parseExperimentRequest(body({ seeds: [1, 2] }), KEYED);
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
    expect(r.costUsd).toBe(0);
    expect(r.estimateUsd).toBe(0);
  });

  it('reports policy decisions to a sink without changing the result', async () => {
    const parsed = parseExperimentRequest(body({ seeds: [1, 2] }), KEYED);
    if (!parsed.ok) throw new Error(parsed.error);
    const plain = await runExperimentSpec(parsed.spec, async () => {});
    const seen: string[] = [];
    const sunk = await runExperimentSpec(parsed.spec, async () => {}, { create: null, onDecision: async (_a, _s, d) => void seen.push(d.source) });
    // Same digests (and everything else) as the sync policy world.
    expect(sunk).toEqual(plain);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s === 'policy')).toBe(true);
    expect(Object.keys(plain.runs[0].runs[0].navs)).toEqual(parsed.spec.base.funds);
  });

  const modelSpec = (budgetUsd: number) => {
    const parsed = parseExperimentRequest(
      body({ variable: 'brains', values: [{}, { 'crown-meridian': 'claude-haiku-5-5' }], seeds: [1], budgetUsd }),
      KEYED,
    );
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.spec;
  };
  // Every call answers with a hold through submit_decision: $0.0002 of haiku usage.
  const create = vi.fn(async () => ({
    id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't', name: 'submit_decision', input: { action: 'hold', reasoning: 'calm', confidence: 0.5 } }],
    usage: { input_tokens: 1000, output_tokens: 200 },
  })) as never as CreateMessage & ReturnType<typeof vi.fn>;

  it('runs model brains through the injected provider and reports cost and estimate', async () => {
    create.mockClear();
    const seen: string[] = [];
    const r = await runExperimentSpec(modelSpec(25), async () => {}, { create, onDecision: async (arm, _seed, d) => void seen.push(`${arm}:${d.source}`) });
    expect(create.mock.calls.length).toBeGreaterThan(0);
    expect(r.costUsd).toBeCloseTo(create.mock.calls.length * 0.0002, 10);
    expect(r.estimateUsd).toBeGreaterThan(r.costUsd);
    expect(r.arms[1].fallbackRate).toBe(0);
    // Both arms report decisions (stored for replay); only the model arm ever reaches the model.
    expect(seen.some((s) => s.startsWith('brains=crown-meridian:claude-haiku-5-5:llm'))).toBe(true);
    expect(seen.filter((s) => !s.startsWith('brains=crown-meridian:claude-haiku-5-5:')).every((s) => s.endsWith(':policy'))).toBe(true);
    expect(seen.some((s) => !s.startsWith('brains=crown-meridian:claude-haiku-5-5:'))).toBe(true);
  });

  it('a budget exhausted mid-run stops the experiment before the next call', async () => {
    create.mockClear();
    const seen: unknown[] = [];
    // Room for exactly one worst-case call, so the second must be refused.
    const budget = estimateCallCostUsd('claude-haiku-5-5', MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);
    const err = await runExperimentSpec(modelSpec(budget), async () => {}, { create, onDecision: async (_a, _s, d) => void seen.push(d) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExhausted);
    expect((err as Error).message).toBe('budget exhausted at $0.00');
    expect(create).toHaveBeenCalledTimes(1);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('refuses a model-backed spec with no provider', async () => {
    await expect(runExperimentSpec(modelSpec(5), async () => {}, { create: null })).rejects.toThrow('Model brains need a provider key on the server.');
  });
});

describe('experiment payloads', () => {
  const row: ExperimentRow = {
    id: 3, createdAt: new Date('2026-11-02T10:00:00Z'), name: 'Director on/off', status: 'done', variable: 'directorMode',
    specJson: JSON.stringify(body()), manifestJson: JSON.stringify({ configHash: 'abcd1234', seeds: [1, 2, 3], policyOnly: true }),
    resultJson: JSON.stringify({ arms: [], series: [], runs: [] }), error: null,
    startedAt: new Date('2026-11-02T10:00:01Z'), finishedAt: new Date('2026-11-02T10:00:03Z'),
  };

  it('the list summary carries no spec, manifest or result', () => {
    expect(buildExperimentSummary(row)).toEqual({
      id: 3, name: 'Director on/off', status: 'done', variable: 'directorMode', arms: 2, seeds: 3,
      createdAt: '2026-11-02T10:00:00.000Z', finishedAt: '2026-11-02T10:00:03.000Z',
    });
  });

  it('the detail parses the stored JSON, and a queued experiment has a null result', () => {
    const d = buildExperimentDetail(row);
    expect(d.spec).toEqual(body());
    expect(d.manifest).toMatchObject({ configHash: 'abcd1234' });
    expect(d.result).toEqual({ arms: [], series: [], runs: [] });
    expect(buildExperimentDetail({ ...row, status: 'queued', resultJson: null }).result).toBeNull();
  });

  it('corrupt stored JSON degrades to null instead of throwing', () => {
    const d = buildExperimentDetail({ ...row, resultJson: '{oops', specJson: 'nope' });
    expect(d.result).toBeNull();
    expect(d.spec).toBeNull();
    expect(buildExperimentSummary({ ...row, specJson: 'nope' })).toMatchObject({ arms: 0, seeds: 0 });
  });
});

describe('buildRunReplay', () => {
  const run = (seed: number, nav: number) => ({ seed, digest: 'd', liquidated: [], navs: { a: [nav, nav + 1] }, events: [], sources: {}, costUsd: 0 });
  const row: ExperimentRow = {
    id: 3, createdAt: new Date(), name: 'x', status: 'done', variable: 'directorMode', specJson: JSON.stringify(body()),
    manifestJson: JSON.stringify({ configHash: 'h', policyOnly: true }),
    resultJson: JSON.stringify({ arms: [], series: [], runs: [{ label: 'rule', runs: [run(1, 100), run(2, 200)] }] }),
    error: null, startedAt: null, finishedAt: null,
  };
  const rec = (tick: number) => decisionFromRow({
    tick, fundKey: 'a', source: 'policy', model: null, action: 'hold', ticker: null, dollarAmount: null, confidence: null,
    reasoning: 'r', costUsd: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, toolCallsJson: 'bad json', outcome: null,
  });

  it('returns null for an unknown arm or seed', () => {
    expect(buildRunReplay(row, 'nope', 1, [])).toBeNull();
    expect(buildRunReplay(row, 'rule', 9, [])).toBeNull();
  });

  it("returns the run's own navs, not the first seed's", () => {
    expect(buildRunReplay(row, 'rule', 2, [])?.navs).toEqual({ a: [200, 201] });
  });

  it('caps decisions and flags truncation', () => {
    const many = Array.from({ length: EXPERIMENT_REPLAY_MAX_DECISIONS + 1 }, (_, i) => rec(i));
    const r = buildRunReplay(row, 'rule', 1, many)!;
    expect(r.decisions).toHaveLength(EXPERIMENT_REPLAY_MAX_DECISIONS);
    expect(r.truncated).toBe(true);
    expect(buildRunReplay(row, 'rule', 1, many.slice(0, 5))?.truncated).toBe(false);
  });

  it('maps a stored row, tolerating bad toolCallsJson', () => {
    expect(rec(4).toolCalls).toEqual([]);
    expect(rec(4).decision).toEqual({ action: 'hold', reasoning: 'r', confidence: 0 });
  });
});

describe('navTickAxis', () => {
  const S = SNAPSHOT_EVERY_TICKS;
  it('downsampled: one tick per point, increasing multiples of the snapshot spacing, ends at the raw ends', () => {
    const t = navTickAxis(1500);
    expect(t).toHaveLength(EXPERIMENT_SERIES_POINTS);
    expect(t.every((x, i) => x % S === 0 && (i === 0 || x > t[i - 1]))).toBe(true);
    expect([t[0], t[t.length - 1]]).toEqual([S, S * Math.floor(1500 / S)]);
  });

  it('not downsampled: every snapshot tick', () => {
    const t = navTickAxis(300);
    expect(t).toHaveLength(Math.floor(300 / S));
    expect(t.slice(0, 3)).toEqual([S, 2 * S, 3 * S]);
  });

  it.each([100, 1500])('navs[i] is the raw NAV recorded at navTicks[i] (ticks %i)', (ticks) => {
    const run = simulateWorld({ funds: ALL, directorMode: 'rule', decisionEveryTicks: null, ticks }, 7);
    const t = navTickAxis(ticks);
    for (const f of run.funds) {
      expect(f.navs).toHaveLength(Math.floor(ticks / S));
      const d = downsample(f.navs, EXPERIMENT_SERIES_POINTS);
      expect(d).toHaveLength(t.length);
      d.forEach((v, i) => expect(v).toBe(f.navs[t[i] / S - 1]));
    }
  });
});
