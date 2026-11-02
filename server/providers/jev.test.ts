import { describe, expect, it, vi } from 'vitest';
import { jevConfigFromEnv, proposeWithJev, resolveDirectorMode } from './jev';
import type { DirectorObservation } from '@black-sheep/engine/director';

const OBS: DirectorObservation = {
  tickCount: 100, ticksSinceLastEvent: 50, ticksSinceLastIntervention: null, eventFiredThisTick: false,
  avgAbsChangePct: 0.001, marketChangePct: 0, sectors: ['tech'], fundsAlive: 3, fundsTotal: 3,
};

describe('resolveDirectorMode', () => {
  it('uses a valid env value, else the configured default, else none', () => {
    expect(resolveDirectorMode('none', 'rule')).toBe('none');
    expect(resolveDirectorMode('JEV', 'rule')).toBe('jev');
    expect(resolveDirectorMode(undefined, 'rule')).toBe('rule');
    expect(resolveDirectorMode('chaos', 'rule')).toBe('rule');
    expect(resolveDirectorMode(undefined, 'chaos')).toBe('none');
  });
});

describe('Jev adapter stub (disabled until API details are supplied)', () => {
  it('is unconfigured without both env vars', () => {
    expect(jevConfigFromEnv({})).toBeNull();
    expect(jevConfigFromEnv({ JEV_API_URL: 'https://x' })).toBeNull();
    expect(jevConfigFromEnv({ JEV_API_URL: 'https://x', JEV_API_KEY: 'k' })).toEqual({ url: 'https://x', apiKey: 'k' });
  });

  it('never calls the network and always proposes no intervention, saying why', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const cfg of [null, { url: 'https://x', apiKey: 'k' }]) {
      const r = await proposeWithJev(cfg, OBS);
      expect(r.available).toBe(false);
      expect(r.proposal).toEqual({ kind: 'none' });
      expect(r.rationale).toMatch(/Jev/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
