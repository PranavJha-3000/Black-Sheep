import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  // Set before experiments.ts reads it at import: the runner only builds a provider when keyed.
  process.env.ANTHROPIC_API_KEY = 'test-key';
  return {
    rows: [] as { id: number; status: string; specJson: string; resultJson?: string | null; error?: string | null; hasModelBrains?: boolean; costUsd?: number }[],
    decisionBatches: [] as { experimentId: number; arm: string; seed: number; source: string; toolCallsJson: string }[][],
  };
});

// Every call answers with a hold through submit_decision: $0.0002 of haiku usage.
const fakeCreate = vi.hoisted(() => async () => ({
  id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 't', name: 'submit_decision', input: { action: 'hold', reasoning: 'calm', confidence: 0.5 } }],
  usage: { input_tokens: 1000, output_tokens: 200 },
}));
vi.mock('./providers/anthropic', async (orig) => ({ ...(await orig<object>()), anthropicCreate: () => fakeCreate }));

const matches = (r: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => r[k] === v);

vi.mock('./db', () => ({
  prisma: {
    experiment: {
      findFirst: vi.fn(async () => db.rows.filter((r) => r.status === 'queued').sort((a, b) => a.id - b.id)[0] ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = db.rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = db.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
    experimentDecision: {
      createMany: vi.fn(async ({ data }: { data: (typeof db.decisionBatches)[number] }) => {
        db.decisionBatches.push(data);
        return { count: data.length };
      }),
    },
  },
}));

import { requeueInterrupted, runNextExperiment } from './experiments';
import { prisma } from './db';
import { DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE, MAX_TOOL_ROUNDS } from '../config/game';
import { estimateCallCostUsd } from './budget';

const spec = {
  name: 't',
  variable: 'directorMode',
  values: ['none', 'rule'],
  base: { funds: ['crown-meridian'], directorMode: 'rule', decisionEveryTicks: null, ticks: 60 },
  seeds: [1],
};
const modelSpec = (budgetUsd: number) => ({
  ...spec,
  variable: 'brains',
  values: [{}, { 'crown-meridian': 'claude-haiku-5-5' }],
  budgetUsd,
});

describe('experiment runner', () => {
  beforeEach(() => {
    db.rows = [];
    db.decisionBatches = [];
  });

  it('does nothing when nothing is queued', async () => {
    await expect(runNextExperiment()).resolves.toBe(false);
  });

  it('runs the oldest queued experiment to done with its result', async () => {
    db.rows = [
      { id: 2, status: 'queued', specJson: JSON.stringify(spec) },
      { id: 1, status: 'queued', specJson: JSON.stringify(spec), manifestJson: 'stale' } as typeof db.rows[number],
    ];
    await expect(runNextExperiment()).resolves.toBe(true);
    const done = db.rows.find((r) => r.id === 1)! as typeof db.rows[number] & { manifestJson?: string };
    expect(done.status).toBe('done');
    // Recomputed at run time (review I-2): a stale create-time manifest is replaced.
    expect(JSON.parse(done.manifestJson!)).toMatchObject({ policyOnly: true, seeds: [1] });
    expect(JSON.parse(done.resultJson!).arms).toHaveLength(2);
    expect(db.rows.find((r) => r.id === 2)!.status).toBe('queued');
  });

  it('marks an experiment whose spec no longer validates as failed', async () => {
    db.rows = [{ id: 1, status: 'queued', specJson: JSON.stringify({ ...spec, values: ['rule'] }) }];
    await runNextExperiment();
    expect(db.rows[0].status).toBe('failed');
    expect(db.rows[0].error).toMatch(/value/i);
  });

  it('never runs two experiments at once', async () => {
    db.rows = [
      { id: 1, status: 'queued', specJson: JSON.stringify(spec) },
      { id: 2, status: 'queued', specJson: JSON.stringify(spec) },
    ];
    const [a, b] = await Promise.all([runNextExperiment(), runNextExperiment()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(db.rows.filter((r) => r.status === 'done')).toHaveLength(1);
  });

  it('re-queues experiments interrupted by a restart', async () => {
    db.rows = [{ id: 1, status: 'running', specJson: JSON.stringify(spec), hasModelBrains: false }];
    await requeueInterrupted();
    expect(db.rows[0].status).toBe('queued');
  });

  it('does not requeue a model-backed run', async () => {
    db.rows = [
      { id: 1, status: 'running', specJson: JSON.stringify(modelSpec(5)), hasModelBrains: true },
      { id: 2, status: 'running', specJson: JSON.stringify(spec), hasModelBrains: false },
    ];
    await requeueInterrupted();
    // Rerunning would pay the provider twice.
    expect(db.rows[0]).toMatchObject({ status: 'failed', error: 'interrupted by restart' });
    expect(db.rows[1].status).toBe('queued');
  });

  it('keeps the spend persisted before a restart', async () => {
    db.rows = [{ id: 1, status: 'running', specJson: JSON.stringify(modelSpec(5)), hasModelBrains: true, costUsd: 0.37 }];
    await requeueInterrupted();
    expect(db.rows[0]).toMatchObject({ status: 'failed', costUsd: 0.37 });
  });

  it('persists spend after each paid call while still running', async () => {
    vi.mocked(prisma.experiment.update).mockClear();
    db.rows = [{ id: 1, status: 'queued', specJson: JSON.stringify(modelSpec(25)) }];
    await runNextExperiment();
    // Mid-run writes carry costUsd and no status; a restart after any paid call finds its spend on the row.
    const mid = vi.mocked(prisma.experiment.update).mock.calls.map(([a]) => a.data as Record<string, unknown>).filter((d) => !('status' in d));
    expect(mid.length).toBeGreaterThan(0);
    expect(mid[0].costUsd).toBeGreaterThan(0);
    expect(mid.at(-1)!.costUsd).toBeCloseTo(db.rows[0].costUsd!);
  });

  it('records spend when a model-backed experiment fails for a non-budget reason', async () => {
    // Batch 1 is the policy arm; batch 2 (the paid model run) fails to write.
    vi.mocked(prisma.experimentDecision.createMany)
      .mockImplementationOnce((async () => ({ count: 1 })) as never)
      .mockImplementationOnce((async () => { throw new Error('disk full'); }) as never);
    db.rows = [{ id: 1, status: 'queued', specJson: JSON.stringify(modelSpec(25)) }];
    await runNextExperiment();
    expect(db.rows[0]).toMatchObject({ status: 'failed', error: 'disk full' });
    expect(db.rows[0].costUsd).toBeGreaterThan(0);
  });

  it('writes decisions in batches per run', async () => {
    db.rows = [{ id: 7, status: 'queued', specJson: JSON.stringify({ ...modelSpec(25), seeds: [1, 2] }) }];
    await runNextExperiment();
    const done = db.rows[0];
    expect(done.status).toBe('done');
    // One createMany per run (2 arms x 2 seeds), each holding exactly one run's decisions.
    expect(db.decisionBatches).toHaveLength(4);
    for (const batch of db.decisionBatches) {
      expect(batch.length).toBeGreaterThan(0);
      expect(new Set(batch.map((d) => `${d.experimentId}/${d.arm}/${d.seed}`)).size).toBe(1);
      expect(batch[0].experimentId).toBe(7);
    }
    // The policy arm is stored too (source policy); the model arm reaches the model.
    expect(db.decisionBatches[0].every((d) => d.source === 'policy')).toBe(true);
    expect(db.decisionBatches[2].some((d) => d.source === 'llm')).toBe(true);
    // The stub answers straight away, so no research tool was called.
    expect(JSON.parse(db.decisionBatches[2].find((d) => d.source === 'llm')!.toolCallsJson)).toEqual([]);
    expect(done.costUsd).toBeGreaterThan(0);
    const run = JSON.parse(done.resultJson!).runs[1].runs[0];
    expect(run).toMatchObject({ seed: 1, costUsd: expect.any(Number) });
    expect(Object.keys(run.navs)).toEqual(['crown-meridian']);
    expect(run.sources['crown-meridian'].llm).toBeGreaterThan(0);
    expect(Array.isArray(run.events)).toBe(true);
  });

  it('records budget exhaustion as failed with spend', async () => {
    // Room for exactly one worst-case call, so the second is refused mid-run.
    const oneCall = estimateCallCostUsd('claude-haiku-5-5', MAX_TOOL_ROUNDS, DECISION_MAX_TOKENS, DECISION_PROMPT_TOKENS_ESTIMATE);
    db.rows = [{ id: 1, status: 'queued', specJson: JSON.stringify(modelSpec(oneCall)) }];
    await runNextExperiment();
    expect(db.rows[0]).toMatchObject({ status: 'failed', error: 'budget exhausted at $0.00', costUsd: 0.0002 });
    // The decisions made before the stop are kept, including the interrupted run's.
    const last = db.decisionBatches.at(-1)!;
    expect(last.some((d) => d.source === 'llm')).toBe(true);
  });
});
