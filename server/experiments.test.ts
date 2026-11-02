import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: [] as { id: number; status: string; specJson: string; resultJson?: string | null; error?: string | null }[],
}));

vi.mock('./db', () => ({
  prisma: {
    experiment: {
      findFirst: vi.fn(async () => db.rows.filter((r) => r.status === 'queued').sort((a, b) => a.id - b.id)[0] ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: number; status: string }; data: Record<string, unknown> }) => {
        const hit = db.rows.filter((r) => (where.id === undefined || r.id === where.id) && r.status === where.status);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const r = db.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
    },
  },
}));

import { requeueInterrupted, runNextExperiment } from './experiments';

const spec = {
  name: 't',
  variable: 'directorMode',
  values: ['none', 'rule'],
  base: { funds: ['crown-meridian'], directorMode: 'rule', decisionEveryTicks: null, ticks: 60 },
  seeds: [1],
};

describe('experiment runner', () => {
  beforeEach(() => {
    db.rows = [];
  });

  it('does nothing when nothing is queued', async () => {
    await expect(runNextExperiment()).resolves.toBe(false);
  });

  it('runs the oldest queued experiment to done with its result', async () => {
    db.rows = [
      { id: 2, status: 'queued', specJson: JSON.stringify(spec) },
      { id: 1, status: 'queued', specJson: JSON.stringify(spec) },
    ];
    await expect(runNextExperiment()).resolves.toBe(true);
    const done = db.rows.find((r) => r.id === 1)!;
    expect(done.status).toBe('done');
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
    db.rows = [{ id: 1, status: 'running', specJson: JSON.stringify(spec) }];
    await requeueInterrupted();
    expect(db.rows[0].status).toBe('queued');
  });
});
