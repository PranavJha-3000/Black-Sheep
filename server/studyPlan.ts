import type { ExperimentSpec } from '@black-sheep/engine/experiment';
import { EXPERIMENT_MAX_BUDGET_USD } from '../config/game';
import { parseExperimentRequest } from './labCore';

/**
 * studyPlan — PURE guard for the pre-registered study (paper/study/*.json).
 * Every file must parse exactly as the lab API would parse it, fit the per-experiment
 * cap and its own budgetUsd at worst case, carry a unique name, and (for `brains`)
 * put the all-policy arm first so the leaderboard and the paper can pair against it.
 */
export function checkStudyPlan(
  files: { path: string; spec: unknown }[],
  estimate: (spec: ExperimentSpec) => number,
): { ok: true; totalUsd: number; perFile: { path: string; usd: number }[] } | { ok: false; error: string } {
  const perFile: { path: string; usd: number }[] = [];
  const names = new Set<string>();
  for (const { path, spec: raw } of files) {
    const fail = (msg: string) => ({ ok: false as const, error: `${path}: ${msg}` });
    const parsed = parseExperimentRequest(raw, { providerConfigured: true });
    if (!parsed.ok) return fail(parsed.error);
    const spec = parsed.spec;
    if (names.has(spec.name)) return fail(`duplicate experiment name ${spec.name}.`);
    names.add(spec.name);
    const first = spec.values[0];
    if (spec.variable === 'brains' && !(first && typeof first === 'object' && Object.keys(first).length === 0)) {
      return fail('a brains study must list the all-policy arm {} as its first value.');
    }
    const usd = estimate(spec);
    if (usd > EXPERIMENT_MAX_BUDGET_USD) return fail(`worst case $${usd.toFixed(2)} exceeds the $${EXPERIMENT_MAX_BUDGET_USD} cap.`);
    // Below its estimate the experiment would stop early on BudgetExhausted and lose runs.
    if (usd > (spec.budgetUsd ?? 0)) return fail(`worst case $${usd.toFixed(2)} exceeds its budgetUsd.`);
    perFile.push({ path, usd });
  }
  return { ok: true, totalUsd: perFile.reduce((s, f) => s + f.usd, 0), perFile };
}
