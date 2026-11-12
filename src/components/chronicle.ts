import { FUND_PROFILES } from '@black-sheep/engine/funds';
import { expandArms } from '@black-sheep/engine/experiment';
import type { ExperimentDetail } from '../../server/labCore';
import { STARTING_CAPITAL } from '../../config/game';

const FUND_NAME: Record<string, string> = Object.fromEntries(FUND_PROFILES.map((p) => [p.key, p.name]));
export const fundName = (k: string) => (FUND_NAME[k] ?? k).toUpperCase();
const signed = (n: number, dp = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(dp)}%`;

export interface Card {
  experimentId: number;
  experiment: string;
  arm: string;
  seed: number;
  date: string;
  brains: string;
  outcome: { text: string; tone: 'good' | 'bad' }[];
  costUsd: number;
}

/** One card per run of a done experiment. Pure: a run's outcome comes from its last NAV and its liquidated list. */
export function cardsOf(d: ExperimentDetail): Card[] {
  if (!d.result) return [];
  // Stored specs are data: one that no longer expands only loses its brains line.
  let arms: ReturnType<typeof expandArms> = [];
  try {
    arms = d.spec ? expandArms(d.spec) : [];
  } catch {
    arms = [];
  }
  return d.result.runs.flatMap((arm) => {
    const b = arms.find((a) => a.label === arm.label)?.config.brains ?? {};
    const brains = Object.entries(b).map(([k, v]) => `${fundName(k)}: ${v}`).join(' · ') || 'policies';
    // Runs stored before navs existed are not replayable: skipped, like leaderboardCore.
    return (arm.runs ?? []).filter((run) => run.navs).map((run): Card => {
      const rets = Object.entries(run.navs)
        .filter(([, n]) => n.length)
        .map(([k, n]) => ({ k, r: n[n.length - 1] / STARTING_CAPITAL - 1 }))
        .sort((x, y) => y.r - x.r);
      const outcome: Card['outcome'] = [];
      if (rets.length) {
        const best = rets[0], worst = rets[rets.length - 1];
        outcome.push({ text: `${fundName(best.k)} ${signed(best.r)}`, tone: best.r >= 0 ? 'good' : 'bad' });
        if (rets.length > 1) outcome.push({ text: `${fundName(worst.k)} ${signed(worst.r)}`, tone: worst.r >= 0 ? 'good' : 'bad' });
      }
      for (const k of run.liquidated ?? []) outcome.push({ text: `${fundName(k)} liquidated`, tone: 'bad' });
      return { experimentId: d.id, experiment: d.name, arm: arm.label, seed: run.seed, date: (d.finishedAt ?? d.createdAt).slice(0, 10), brains, outcome, costUsd: run.costUsd };
    });
  });
}

