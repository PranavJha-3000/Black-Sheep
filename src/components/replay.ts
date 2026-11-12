import type { DecisionRecord } from '@black-sheep/engine/experiment';
import type { SelectedRun } from '../store/gameStore';

/** The last nav point recorded at or before `tick` (0 when the tick precedes them all). */
export function navIndexAt(navTicks: number[], tick: number): number {
  let i = 0;
  while (i + 1 < navTicks.length && navTicks[i + 1] <= tick) i++;
  return i;
}

/** Decisions with tick ≤ the cursor's tick, newest first; `fresh` = made since the previous nav point. */
export function feedAt(decisions: DecisionRecord[], navTicks: number[], index: number): { d: DecisionRecord; fresh: boolean }[] {
  const tick = navTicks[index] ?? Infinity;
  const prev = index > 0 ? navTicks[index - 1] : -Infinity;
  return decisions
    .filter((d) => d.tick <= tick)
    .sort((a, b) => b.tick - a.tick)
    .map((d) => ({ d, fresh: d.tick > prev }));
}

/** `#/timeline/<id>/<arm>/<seed>`: arm labels carry `=`, `:` and `/`, so they are URI-encoded. */
export function replayHash(run: SelectedRun): string {
  return `#/timeline/${run.experimentId}/${encodeURIComponent(run.arm)}/${run.seed}`;
}

export function parseReplayHash(hash: string): SelectedRun | null {
  const m = /^#\/timeline\/(\d+)\/([^/]+)\/(\d+)$/.exec(hash);
  if (!m) return null;
  try {
    return { experimentId: Number(m[1]), arm: decodeURIComponent(m[2]), seed: Number(m[3]) };
  } catch {
    return null; // malformed %-escape in a hand-edited URL
  }
}
