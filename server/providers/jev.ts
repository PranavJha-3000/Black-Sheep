import type { DirectorObservation } from '@black-sheep/engine/director';

/**
 * Jev (TypeSafe System One) — the World Director's model adapter (VISION §8).
 *
 * DISABLED STUB. VISION §8 requires investigating Jev's official API, pricing,
 * response contract and usage reporting before implementation; those details
 * have not been supplied. Until they are, this adapter makes no network call
 * and always proposes no intervention, so a world run in `jev` mode behaves
 * exactly like `none` and says so in every DirectorDecisionLog row.
 *
 * When implemented it must: receive only the public DirectorObservation,
 * return a proposal that the server passes through validateIntervention,
 * and meter its spend separately from the funds (VISION §12).
 */

export type DirectorMode = 'none' | 'rule' | 'jev';

const MODES: DirectorMode[] = ['none', 'rule', 'jev'];

/** A valid env override wins, then the configured default; anything else means no Director. */
export function resolveDirectorMode(envValue: string | undefined, configured: string): DirectorMode {
  const fromEnv = envValue?.toLowerCase();
  if (MODES.includes(fromEnv as DirectorMode)) return fromEnv as DirectorMode;
  return MODES.includes(configured as DirectorMode) ? (configured as DirectorMode) : 'none';
}

export interface JevConfig {
  url: string;
  apiKey: string;
}

/** Server-side credentials only (JEV_API_URL, JEV_API_KEY); null until both are set. */
export function jevConfigFromEnv(env: Record<string, string | undefined>): JevConfig | null {
  const url = env.JEV_API_URL;
  const apiKey = env.JEV_API_KEY;
  return url && apiKey ? { url, apiKey } : null;
}

export interface JevProposal {
  /** Unvalidated; the caller runs validateIntervention. */
  proposal: unknown;
  rationale: string;
  /** False while the adapter is a stub or unconfigured. */
  available: boolean;
}

export async function proposeWithJev(config: JevConfig | null, _obs: DirectorObservation): Promise<JevProposal> {
  return {
    proposal: { kind: 'none' },
    rationale: config
      ? 'Jev adapter not implemented yet: its API contract has not been supplied (VISION §8). No intervention.'
      : 'Jev not configured (JEV_API_URL / JEV_API_KEY unset). No intervention.',
    available: false,
  };
}
