import { experimentManifest, type ExperimentSpec } from '@black-sheep/engine/experiment';
import { EXPERIMENT_MAX_BUDGET_USD } from '../config/game';
import { MODEL_REGISTRY } from '../config/models';
import { parseExperimentRequest } from './labCore';
import { preregMismatch } from './paperCore';

/** The study is checked as if every provider had a key. */
const ALL_PROVIDERS = new Set(Object.values(MODEL_REGISTRY).map((m) => m.provider));

/**
 * studyPlan — PURE guard for the pre-registered study (paper/study/*.json).
 * Every file must parse exactly as the lab API would parse it, fit the per-experiment
 * cap and its own budgetUsd at worst case, carry a unique name, and (for `brains`)
 * put the all-policy arm first so the leaderboard and the paper can pair against it.
 */
export function checkStudyPlan(
  files: { path: string; spec: unknown }[],
  estimate: (spec: ExperimentSpec) => number,
): { ok: true; totalUsd: number; perFile: { path: string; name: string; configHash: string; usd: number }[] } | { ok: false; error: string } {
  const perFile: { path: string; name: string; configHash: string; usd: number }[] = [];
  const names = new Set<string>();
  for (const { path, spec: raw } of files) {
    const fail = (msg: string) => ({ ok: false as const, error: `${path}: ${msg}` });
    const parsed = parseExperimentRequest(raw, { providers: ALL_PROVIDERS });
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
    perFile.push({ path, name: spec.name, configHash: experimentManifest(spec).configHash, usd });
  }
  return { ok: true, totalUsd: perFile.reduce((s, f) => s + f.usd, 0), perFile };
}

/**
 * Resumable submission: a file whose name already has a non-failed experiment (queued, running or done)
 * is skipped, so a re-run after a partial failure neither pays twice nor double-counts seeds.
 * Failed experiments are resubmitted under the same name (PREREGISTRATION amendment 1).
 * A same-named experiment with another configHash is not the pre-registered one: refuse, never skip.
 * `configHash` is the file's, as checkStudyPlan parses it.
 */
export function pendingSubmissions<F extends { path: string; spec: unknown; configHash: string }>(
  files: F[],
  existing: { name: string; id: number; status: string; configHash: string | null }[],
): { ok: true; items: { file: F; skip: { id: number; status: string } | null }[] } | { ok: false; error: string } {
  const items: { file: F; skip: { id: number; status: string } | null }[] = [];
  for (const file of files) {
    const name = String((file.spec as { name?: unknown }).name);
    const named = existing.filter((e) => e.name === name);
    const other = named.find((e) => e.configHash !== file.configHash);
    if (other) return { ok: false, error: preregMismatch(other.id, name, other.configHash, file.configHash) };
    const live = named.filter((e) => e.status !== 'failed').sort((a, b) => b.id - a.id)[0];
    items.push({ file, skip: live ? { id: live.id, status: live.status } : null });
  }
  return { ok: true, items };
}
