import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('restores a legacy persisted session that still has lastSeenAt', async () => {
    localStorage.setItem(
      'black_sheep_session',
      JSON.stringify({ token: 't', user: { id: 1, email: 'a@b.c' }, roomCode: 'ABC234', lastSeenAt: 1 }),
    );
    vi.resetModules();
    const { useGameStore: fresh } = await import('./gameStore');
    expect(fresh.getState().token).toBe('t');
    expect(fresh.getState().roomCode).toBe('ABC234');
    localStorage.clear();
  });
});
