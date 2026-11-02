import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';
import { STARTING_CAPITAL } from '../../config/game';

// NOTE (Phase 4): the old integration tests drove the REMOVED local tick loop
// (store.tick + local rival brain). The store is now a server projection:
// these tests pin the offline/seeded initial state only. Live rival behavior
// is covered by stateMapper tests (wire → projection) plus the server-side
// world tests.


describe('rival integration (store wiring)', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('is an observer store: no auth, session or lobby state', () => {
    const s = useGameStore.getState() as unknown as Record<string, unknown>;
    for (const k of ['phase', 'token', 'user', 'roomCode', 'login', 'register', 'createRoom', 'joinRoom', 'logout']) {
      expect(k in s).toBe(false);
    }
  });

  it('reset() restores the seed projection', () => {
    useGameStore.setState({ nav: 1, fundId: 42 });
    useGameStore.getState().reset();
    const s = useGameStore.getState();
    expect(s.nav).toBe(STARTING_CAPITAL);
    expect(s.fundId).toBeNull();
    expect(s.events).toEqual([]);
  });

  it('is observer-only: the store exposes no trading actions', () => {
    const s = useGameStore.getState() as unknown as Record<string, unknown>;
    expect(s.buy).toBeUndefined();
    expect(s.short).toBeUndefined();
    expect(s.closePosition).toBeUndefined();
  });

  it('carries no away-summary state or actions', () => {
    const s = useGameStore.getState() as unknown as Record<string, unknown>;
    expect('awaySummary' in s).toBe(false);
    expect(s.fetchAwaySummary).toBeUndefined();
    expect(s.dismissAwaySummary).toBeUndefined();
  });

  it('carries no player-vs-rival state', () => {
    const s = useGameStore.getState() as unknown as Record<string, unknown>;
    for (const k of ['confrontation', 'contested', 'dismissConfrontation', 'rivalHistory', 'liquidationRivalContext']) {
      expect(k in s).toBe(false);
    }
  });
});
