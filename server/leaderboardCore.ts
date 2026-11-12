import { expandArms, type ExperimentSpec, type FundBrain } from '@black-sheep/engine/experiment';
import { seriesMetrics } from '@black-sheep/engine/metrics';
import { bootstrapMeanCI } from '@black-sheep/engine/stats';
import { STARTING_CAPITAL } from '../config/game';
import { MODEL_REGISTRY } from '../config/models';
import type { ExperimentResult, ExperimentRow } from './labCore';

export interface LeaderboardRow {
  brain: FundBrain;
  displayName: string;
  experiments: number;
  runs: number;
  meanReturn: number | null;
  returnCI: [number, number] | null;
  survival: number;
  pairedVsPolicy: { wins: number; pairs: number; meanDiff: number; ci: [number, number] | null } | null;
  meanCostPerDecision: number | null;
  /** Share of model decisions that fell back to policy (fallback / (llm + fallback)); null for Policy or no model decisions. */
  fallbackRate: number | null;
  /** Fewer than MIN_RUNS paired samples (runs, for Policy): listed, but not evidence. */
  insufficient: boolean;
}

const MIN_RUNS = 5;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Sample {
  brain: FundBrain;
  exp: number;
  ret: number;
  survived: boolean;
  cost: number;
  decisions: number;
  fallbacks: number;
  diff: number | null;
  key: string;
}

function parse<T>(json: string | null): T | null {
  try {
    return json === null ? null : (JSON.parse(json) as T);
  } catch {
    return null;
  }
}

/** Every done brains experiment, pooled per brain; subject funds only; paired within the same experiment and seed. */
export function buildLeaderboard(rows: ExperimentRow[]): LeaderboardRow[] {
  const samples: Sample[] = [];
  for (const row of rows) {
    if (row.status !== 'done' || row.variable !== 'brains') continue;
    const spec = parse<ExperimentSpec>(row.specJson);
    const result = parse<ExperimentResult>(row.resultJson);
    // Pre-per-run-navs results cannot be scored: skip, not an error.
    if (!spec || !result || !Array.isArray(result.runs) || result.runs.some((a) => a.runs.some((r) => !r.navs))) continue;
    let arms: ReturnType<typeof expandArms>;
    try {
      arms = expandArms(spec);
    } catch {
      continue; // malformed stored spec: skip the row, never 500 the public board
    }
    const brainOf = (label: string, fund: string): FundBrain => arms.find((a) => a.label === label)?.config.brains?.[fund] ?? 'policy';
    const subjects = new Set(arms.flatMap((a) => Object.entries(a.config.brains ?? {}).filter(([, b]) => b !== 'policy').map(([f]) => f)));
    // Partners come only from the all-policy baseline arm, so a mixed arm never overwrites them.
    const isBaseline = (label: string) => Object.values(arms.find((a) => a.label === label)?.config.brains ?? {}).every((b) => b === 'policy');
    const policyReturn = new Map<string, number>();
    const mine: Sample[] = [];
    for (const arm of result.runs) {
      for (const run of arm.runs) {
        for (const fund of subjects) {
          const navs = run.navs[fund];
          const ret = navs && seriesMetrics(navs, STARTING_CAPITAL).totalReturn;
          if (ret === null || ret === undefined || !Number.isFinite(ret)) continue;
          const brain = brainOf(arm.label, fund);
          if (brain === 'policy' && isBaseline(arm.label)) policyReturn.set(`${fund}|${run.seed}`, ret);
          const src = run.sources?.[fund];
          // A model run with no model decision at all (bad key, outage) measured the policy, not the model.
          if (brain !== 'policy' && !src?.llm) continue;
          // shortcut: run cost is attributed to the subject fund — exact while the form allows one model fund per arm; per-fund cost when multi-model arms exist
          mine.push({ brain, exp: row.id, ret, survived: !(run.liquidated ?? []).includes(fund), cost: run.costUsd, decisions: src ? src.llm + src.fallback : 0, fallbacks: src?.fallback ?? 0, diff: null, key: `${fund}|${run.seed}` });
        }
      }
    }
    for (const s of mine) {
      const p = policyReturn.get(s.key);
      if (s.brain !== 'policy' && p !== undefined) s.diff = s.ret - p;
    }
    samples.push(...mine);
  }

  const out: LeaderboardRow[] = [];
  for (const brain of new Set(samples.map((s) => s.brain))) {
    const ss = samples.filter((s) => s.brain === brain);
    const rets = ss.map((s) => s.ret);
    const diffs = ss.flatMap((s) => (s.diff === null ? [] : [s.diff]));
    const decisions = ss.reduce((a, s) => a + s.decisions, 0);
    out.push({
      brain,
      displayName: brain === 'policy' ? 'Policy' : MODEL_REGISTRY[brain]?.displayName ?? brain,
      experiments: new Set(ss.map((s) => s.exp)).size,
      runs: ss.length,
      meanReturn: mean(rets),
      returnCI: bootstrapMeanCI(rets),
      survival: ss.filter((s) => s.survived).length / ss.length,
      pairedVsPolicy:
        brain === 'policy' || diffs.length === 0
          ? null
          : { wins: diffs.filter((d) => d > 0).length, pairs: diffs.length, meanDiff: mean(diffs), ci: bootstrapMeanCI(diffs) },
      meanCostPerDecision: brain === 'policy' || decisions === 0 ? null : ss.reduce((a, s) => a + s.cost, 0) / decisions,
      fallbackRate: brain === 'policy' || decisions === 0 ? null : ss.reduce((a, s) => a + s.fallbacks, 0) / decisions,
      // Model rows are ranked by the paired edge, so evidence is counted in pairs, not runs.
      insufficient: (brain === 'policy' ? ss.length : diffs.length) < MIN_RUNS,
    });
  }
  // Paired edge over policy first (null last), then raw mean return.
  const edge = (r: LeaderboardRow) => r.pairedVsPolicy?.meanDiff ?? null;
  return out.sort((a, b) => {
    const [x, y] = [edge(a), edge(b)];
    if (x !== y && (x === null || y === null)) return x === null ? 1 : -1;
    return (y ?? 0) - (x ?? 0) || (b.meanReturn ?? 0) - (a.meanReturn ?? 0);
  });
}

/**
 * The board, rebuilt only when the done brains rows change. Done rows are immutable and only ever added,
 * so their (count, max id) identifies the set; `key` comes from one cheap aggregate query.
 * shortcut: a deleted-and-replaced done row with the same count and max id would serve a stale board; key on updatedAt if rows ever become deletable.
 */
export function makeLeaderboardCache() {
  let cached: { key: string; board: LeaderboardRow[] } | null = null;
  return async (key: string, load: () => Promise<ExperimentRow[]>): Promise<LeaderboardRow[]> => {
    if (cached?.key !== key) cached = { key, board: buildLeaderboard(await load()) };
    return cached.board;
  };
}
