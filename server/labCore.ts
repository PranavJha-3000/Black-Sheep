import { createHash, timingSafeEqual } from 'node:crypto';
import {
  canonicalJson,
  compareArms,
  downsample,
  expandArms,
  EXPERIMENT_VARIABLES,
  simulateWorld,
  type ArmComparison,
  type ArmConfig,
  type ExperimentSpec,
  type ExperimentVariable,
  type RunResult,
} from '@black-sheep/engine/experiment';
import { getFundProfile } from '@black-sheep/engine/funds';
import {
  EXPERIMENT_MAX_ARMS,
  EXPERIMENT_MAX_SEEDS,
  EXPERIMENT_MAX_TICKS,
  EXPERIMENT_SERIES_POINTS,
} from '../config/game';

/**
 * labCore — PURE Research Lab rules (VISION §10, D-032, D-033): validate an
 * experiment request, check the admin token, and run an experiment spec into
 * its stored result. No I/O except the injected yield.
 */

const NAME_MAX = 80;
const MIN_TICKS = 10;
const MAX_CADENCE = 100;
const MAX_SEED = 2 ** 31 - 1;

type Check<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);

function checkFunds(x: unknown): Check<string[]> {
  if (!Array.isArray(x) || x.length === 0) return fail('A fund set must list at least one registry fund key.');
  if (new Set(x).size !== x.length) return fail('A fund set lists the same fund twice.');
  for (const k of x) if (typeof k !== 'string' || !getFundProfile(k)) return fail(`Unknown fund key: ${String(k)}.`);
  return { ok: true, value: x as string[] };
}

function checkDirector(x: unknown): Check<ArmConfig['directorMode']> {
  return x === 'none' || x === 'rule' ? { ok: true, value: x } : fail(`Director mode must be 'none' or 'rule' (got ${String(x)}).`);
}

function checkCadence(x: unknown): Check<number | null> {
  if (x === null) return { ok: true, value: null };
  return isInt(x) && x >= 1 && x <= MAX_CADENCE ? { ok: true, value: x } : fail(`Decision cadence must be null or an integer 1–${MAX_CADENCE}.`);
}

const VALUE_CHECKS: Record<ExperimentVariable, (x: unknown) => Check<unknown>> = {
  directorMode: checkDirector,
  funds: checkFunds,
  decisionEveryTicks: checkCadence,
};

function checkBase(x: unknown): Check<ArmConfig> {
  if (!x || typeof x !== 'object') return fail('Missing base configuration.');
  const b = x as Record<string, unknown>;
  const funds = checkFunds(b.funds);
  if (!funds.ok) return funds;
  const directorMode = checkDirector(b.directorMode);
  if (!directorMode.ok) return directorMode;
  const cadence = checkCadence(b.decisionEveryTicks ?? null);
  if (!cadence.ok) return cadence;
  if (!isInt(b.ticks) || b.ticks < MIN_TICKS || b.ticks > EXPERIMENT_MAX_TICKS) {
    return fail(`Ticks must be an integer ${MIN_TICKS}–${EXPERIMENT_MAX_TICKS}.`);
  }
  return { ok: true, value: { funds: funds.value, directorMode: directorMode.value, decisionEveryTicks: cadence.value, ticks: b.ticks } };
}

/** Validate an untrusted create request. Everything a run needs is checked here, before anything is stored. */
export function parseExperimentRequest(body: unknown): { ok: true; spec: ExperimentSpec } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return fail('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0 || name.length > NAME_MAX) return fail(`Name must be 1–${NAME_MAX} characters.`);

  if (!(EXPERIMENT_VARIABLES as readonly unknown[]).includes(b.variable)) {
    return fail(`Variable must be one of ${EXPERIMENT_VARIABLES.join(', ')}.`);
  }
  const variable = b.variable as ExperimentVariable;

  const base = checkBase(b.base);
  if (!base.ok) return base;

  if (!Array.isArray(b.values)) return fail('Values must be an array.');
  const values: unknown[] = [];
  const seen = new Set<string>();
  for (const v of b.values) {
    const c = VALUE_CHECKS[variable](v);
    if (!c.ok) return c;
    const key = canonicalJson(c.value);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(c.value);
    }
  }
  if (values.length < 2) return fail('An experiment needs at least two distinct values (one arm per value).');
  if (values.length > EXPERIMENT_MAX_ARMS) return fail(`At most ${EXPERIMENT_MAX_ARMS} values (arms).`);

  const seeds = b.seeds;
  if (!Array.isArray(seeds) || seeds.length === 0 || seeds.length > EXPERIMENT_MAX_SEEDS) {
    return fail(`Seeds must list 1–${EXPERIMENT_MAX_SEEDS} integers.`);
  }
  if (!seeds.every((s) => isInt(s) && s >= 0 && s <= MAX_SEED)) return fail(`Seeds must be integers 0–${MAX_SEED}.`);
  if (new Set(seeds).size !== seeds.length) return fail('Seeds must be distinct.');

  return { ok: true, spec: { name, base: base.value, variable, values, seeds: seeds as number[] } };
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * The lab's write boundary (VISION §13, D-033). No configured token disables
 * lab writes; otherwise only an exact `Bearer <token>` passes. Compared as
 * equal-length digests in constant time.
 */
export function checkLabToken(header: string | undefined, configured: string | undefined): 'ok' | 'disabled' | 'unauthorized' {
  if (!configured) return 'disabled';
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return 'unauthorized';
  return timingSafeEqual(digest(m[1]), digest(configured)) ? 'ok' : 'unauthorized';
}

export interface ExperimentResult {
  arms: ArmComparison[];
  /** NAV series of the first seed's run, per arm and fund, downsampled for charts. */
  series: { label: string; funds: { key: string; navs: number[] }[] }[];
  /** Per-run fingerprints: rerunning a seed must reproduce its digest. */
  runs: { label: string; runs: { seed: number; digest: string; liquidated: string[] }[] }[];
}

/** Run every arm on every seed; `yieldFn` runs between runs so the server's event loop stays responsive. */
export async function runExperimentSpec(spec: ExperimentSpec, yieldFn: () => Promise<void>): Promise<ExperimentResult> {
  const arms: { label: string; runs: RunResult[] }[] = [];
  for (const arm of expandArms(spec)) {
    const runs: RunResult[] = [];
    for (const seed of spec.seeds) {
      runs.push(simulateWorld(arm.config, seed));
      await yieldFn();
    }
    arms.push({ label: arm.label, runs });
  }
  return {
    arms: compareArms(arms),
    series: arms.map((a) => ({
      label: a.label,
      funds: (a.runs[0]?.funds ?? []).map((f) => ({ key: f.key, navs: downsample(f.navs, EXPERIMENT_SERIES_POINTS) })),
    })),
    runs: arms.map((a) => ({
      label: a.label,
      runs: a.runs.map((r) => ({ seed: r.seed, digest: r.digest, liquidated: r.funds.filter((f) => f.liquidated).map((f) => f.key) })),
    })),
  };
}
