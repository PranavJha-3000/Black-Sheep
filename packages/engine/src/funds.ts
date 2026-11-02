/*
 * Black Sheep - fund profiles (VISION §6).
 *
 * The typed view of config/funds.ts. A FundProfile is everything that makes a
 * fund *that* fund: identity, mandate, strategy, the model behind it, its risk
 * limit and its decision cadence. Pure TS, zero I/O.
 */

import { FUND_REGISTRY } from '../../../config/funds';
import type { ModelId } from '../../../config/models';
import type { RivalPersonality } from './rival';

export interface FundProfile {
  /** Stable slug, e.g. 'sterling-vale'. */
  key: string;
  /** Display name and in-world identity (unique per world). */
  name: string;
  /** Selects the deterministic fallback policy (policies.ts). */
  personality: RivalPersonality;
  mandate: string;
  strategy: string;
  model: ModelId;
  /** Largest fraction of available cash one new position may use. */
  maxPositionFraction: number;
  /** The fund decides every N engine ticks... */
  decisionEveryTicks: number;
  /** ...on ticks where tickCount % N === offset, so funds are staggered. */
  decisionOffset: number;
}

export const FUND_PROFILES: readonly FundProfile[] = FUND_REGISTRY;

export function getFundProfile(key: string): FundProfile | undefined {
  return FUND_PROFILES.find((p) => p.key === key);
}

export function getFundProfileByName(name: string): FundProfile | undefined {
  return FUND_PROFILES.find((p) => p.name === name);
}
