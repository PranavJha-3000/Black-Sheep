import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialMarket } from '@black-sheep/engine/market';
import { buildWorldStatePayload, type FundInput } from '../../server/worldCore';
import { STARTING_CAPITAL } from '../../config/game';

const pending: { path: string; opts?: { method?: string; body?: unknown; token?: string }; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
vi.mock('./api', () => ({
  apiFetch: (path: string, opts?: { method?: string; body?: unknown; token?: string }) =>
    new Promise((resolve, reject) => pending.push({ path, opts, resolve, reject })),
}));

import { useGameStore } from './gameStore';

function fund(id: number, name: string): FundInput {
  return {
    id, name, cash: STARTING_CAPITAL, startingCapital: STARTING_CAPITAL, peakNav: STARTING_CAPITAL,
    liquidated: false, liquidationCause: null, thinking: false, openPositions: [], lastDecision: null,
  };
}
const world = buildWorldStatePayload({ name: 'live', seed: 1 }, createInitialMarket(), [
  fund(1, 'STERLING & VALE'), fund(2, 'HALDEN WHITMORE'),
], []);

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('gameStore poll ordering (review I-1)', () => {
  beforeEach(() => {
    pending.length = 0;
    useGameStore.setState({ view: 'world', selectedFundId: null, fundId: null, trace: null });
  });

  it('drops a poll that started for a previous selection, so focus never snaps back', async () => {
    useGameStore.getState().openFund(1); // poll A
    useGameStore.getState().openFund(2); // poll B
    const stateCalls = pending.filter((p) => p.path === '/world/state');
    // B lands first, then the stale A.
    stateCalls[1].resolve(world);
    pending.filter((p) => p.path.includes('/trace')).forEach((p) => p.resolve(null));
    await flush();
    expect(useGameStore.getState().fundId).toBe(2);
    stateCalls[0].resolve(world);
    await flush();
    expect(useGameStore.getState().fundId).toBe(2);
  });
});

describe('gameStore ANALYTICS polling', () => {
  beforeEach(() => {
    pending.length = 0;
    useGameStore.setState({ view: 'world', selectedFundId: null, fundId: null, analytics: null });
  });

  it('fetches /world/analytics only while the ANALYTICS view is open', async () => {
    void useGameStore.getState().poll();
    expect(pending.some((p) => p.path === '/world/analytics')).toBe(false);
    pending.length = 0;
    useGameStore.getState().setView('analytics');
    const call = pending.find((p) => p.path === '/world/analytics');
    expect(call).toBeDefined();
    pending.find((p) => p.path === '/world/state')!.resolve(world);
    const payload = { funds: [], world: { events: { count: 0 } }, director: { mode: 'rule' }, notes: [] };
    call!.resolve(payload);
    await flush();
    expect(useGameStore.getState().analytics).toEqual(payload);
  });

  it('does not refetch analytics on every poll (review I-4)', async () => {
    useGameStore.getState().setView('analytics');
    pending.forEach((p) => p.resolve(p.path === '/world/state' ? world : null));
    await flush();
    pending.length = 0;
    void useGameStore.getState().poll();
    expect(pending.some((p) => p.path === '/world/state')).toBe(true);
    expect(pending.some((p) => p.path === '/world/analytics')).toBe(false);
  });
});

describe('gameStore RESEARCH LAB', () => {
  beforeEach(() => {
    pending.length = 0;
    useGameStore.setState({ view: 'world', selectedFundId: null, fundId: null, selectedExperimentId: null, lab: { list: null, detail: null } });
  });

  it('fetches the experiment list only in the lab view, and the detail once one is opened', async () => {
    void useGameStore.getState().poll();
    expect(pending.some((p) => p.path.startsWith('/lab'))).toBe(false);
    pending.length = 0;
    useGameStore.getState().setView('lab');
    expect(pending.map((p) => p.path)).toContain('/lab/experiments');
    pending.forEach((p) => p.resolve(p.path === '/world/state' ? world : { experiments: [{ id: 4 }] }));
    await flush();
    expect(useGameStore.getState().lab.list).toEqual([{ id: 4 }]);
    pending.length = 0;
    useGameStore.getState().openExperiment(4);
    expect(pending.map((p) => p.path)).toContain('/lab/experiments/4');
  });

  it('drops a detail that answers an experiment no longer selected', async () => {
    useGameStore.setState({ view: 'lab' });
    useGameStore.getState().openExperiment(1);
    const first = pending.find((p) => p.path === '/lab/experiments/1')!;
    useGameStore.getState().openExperiment(2);
    pending
      .filter((p) => p.path !== '/lab/experiments/1')
      .forEach((p) => p.resolve(p.path === '/world/state' ? world : p.path === '/lab/experiments/2' ? { id: 2 } : { experiments: [] }));
    await flush();
    first.resolve({ id: 1 });
    await flush();
    expect(useGameStore.getState().lab.detail).toEqual({ id: 2 });
  });

  it('creates an experiment with the bearer token, never storing the token, then opens it', async () => {
    useGameStore.setState({ view: 'lab' });
    const done = useGameStore.getState().createExperiment({ name: 'x' }, 's3cret');
    const post = pending.find((p) => p.opts?.method === 'POST')!;
    expect(post.path).toBe('/lab/experiments');
    expect(post.opts).toEqual({ method: 'POST', body: { name: 'x' }, token: 's3cret' });
    post.resolve({ id: 9 });
    await expect(done).resolves.toEqual({ ok: true, id: 9 });
    expect(useGameStore.getState().selectedExperimentId).toBe(9);
    expect(JSON.stringify(useGameStore.getState())).not.toContain('s3cret');
  });

  it('reports a rejected create as an error message', async () => {
    const done = useGameStore.getState().createExperiment({ name: 'x' }, 'bad');
    pending.find((p) => p.opts?.method === 'POST')!.reject(new Error('A valid lab admin token is required'));
    await expect(done).resolves.toEqual({ ok: false, error: 'A valid lab admin token is required' });
  });
});

describe('gameStore run replay', () => {
  beforeEach(() => {
    pending.length = 0;
    useGameStore.getState().selectRun(null);
  });

  it('fetches the selected run (arm encoded), mirrors it in the hash, and clears both on deselect', async () => {
    const run = { experimentId: 3, arm: 'brains=crown:x', seed: 2 };
    useGameStore.getState().selectRun(run);
    expect(pending.map((p) => p.path)).toEqual(['/lab/experiments/3/runs/brains%3Dcrown%3Ax/2']);
    expect(location.hash).toBe('#/timeline/3/brains%3Dcrown%3Ax/2');
    expect(useGameStore.getState().replay.loading).toBe(true);
    pending[0].resolve({ experimentId: 3 });
    await flush();
    expect(useGameStore.getState().replay).toEqual({ data: { experimentId: 3 }, loading: false, error: null });
    useGameStore.getState().selectRun(null);
    expect(location.hash).toBe('');
    expect(useGameStore.getState().replay.data).toBeNull();
  });

  it('drops a replay answering a run no longer selected, and reports errors', async () => {
    useGameStore.getState().selectRun({ experimentId: 1, arm: 'a', seed: 1 });
    useGameStore.getState().selectRun({ experimentId: 2, arm: 'a', seed: 1 });
    pending[0].resolve({ experimentId: 1 });
    pending[1].reject(new Error('run not found'));
    await flush();
    expect(useGameStore.getState().replay).toEqual({ data: null, loading: false, error: 'run not found' });
  });
});
