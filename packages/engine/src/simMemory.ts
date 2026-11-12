/*
 * Black Sheep - in-world memory for experiment worlds (the `memory` arm variable). PURE.
 *
 * Mirrors server/world.ts rememberDecision using the same rules from memory.ts,
 * but in RAM on SimFund.memory. Only model-backed funds hold memory; policy
 * funds never read it, so policy-only digests cannot change.
 */

import { MEMORY_LOAD_LIMIT } from '../../../config/game';
import type { DecisionSource, SimFund } from './experiment';
import { episodeFromDecision, reflect, relationshipNote, type MemoryEntry } from './memory';

export type MemoryMode = 'none' | 'episodic' | 'reflective' | 'full';

const keep = (m: MemoryEntry[]) => m.slice(-MEMORY_LOAD_LIMIT);

/** Record this tick's applied decisions into model funds' memory. `markNav` prices a fund on the current market. */
export function updateSimMemory(
  funds: SimFund[],
  decided: { f: SimFund; source: DecisionSource }[],
  tick: number,
  mode: MemoryMode,
  markNav: (f: SimFund) => number,
): void {
  if (mode === 'none') return;
  for (const { f, source } of decided) {
    const episode = f.brain === 'policy' ? null : episodeFromDecision(f.fund, markNav(f), tick, source);
    if (episode) {
      const own = [episode];
      const reflection = mode !== 'episodic' && episode.outcomeUsd !== null ? reflect([...f.memory, episode], tick) : null;
      if (reflection) own.push(reflection);
      f.memory = keep([...f.memory, ...own]);
    }
    const last = f.fund.lastDecision;
    if (mode !== 'full' || !last) continue;
    for (const other of funds) {
      if (other === f || other.liquidated || other.brain === 'policy') continue;
      const note = relationshipNote(other.fund.positions, f.profile.name, last, tick);
      if (note) other.memory = keep([...other.memory, note]);
    }
  }
}
