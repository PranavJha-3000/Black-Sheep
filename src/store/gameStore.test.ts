import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialMarket } from '@black-sheep/engine/market';
import { buildWorldStatePayload, type FundInput } from '../../server/worldCore';
import { STARTING_CAPITAL } from '../../config/game';

const pending: { path: string; resolve: (v: unknown) => void }[] = [];
vi.mock('./api', () => ({
  apiFetch: (path: string) => new Promise((resolve) => pending.push({ path, resolve })),
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
});
