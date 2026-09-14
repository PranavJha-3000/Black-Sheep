import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './gameStore';

// NOTE (Phase 4): the old integration tests drove the REMOVED local tick loop
// (store.tick + local rival brain). The store is now a server projection:
// these tests pin the offline/seeded initial state only. Live rival behavior
// is covered by stateMapper tests (wire → confrontation) plus the server-side
// world tests.


describe('rival integration (store wiring)', () => {
  beforeEach(() => {
    useGameStore.getState().restart();
  });

  it('seeds an offline contrarian rival shell at starting capital', () => {
    const s = useGameStore.getState();
    // restart() clears the session and returns to auth (no persisted login).
    expect(s.phase).toBe('auth');
    expect(s.rivalFund).toBeDefined();
    expect(s.rivalFund.personality).toBe('contrarian');
    // The rival book lives on the server: pre-join the client only carries an
    // inert shell (no cash/positions) plus a seed NAV so the terminal renders.
    expect(s.rivalFund.lastDecision).toBeNull();
    expect(s.rivalNav).toBe(10_000_000);
    expect(s.rivalThinking).toBe(false);
  });

  it('restart clears confrontation state entirely', () => {
    useGameStore.getState().restart();
    const r = useGameStore.getState();
    expect(r.confrontation).toBeNull();
    expect(r.contested).toEqual([]);
    expect(r.rivalThinking).toBe(false);
  });
});
