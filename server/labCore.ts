import { createHash, timingSafeEqual } from 'node:crypto';
import {
  armModelFunds,
  canonicalJson,
  compareArms,
  downsample,
  downsampleIndex,
  expandArms,
  EXPERIMENT_VARIABLES,
  simulateWorld,
  simulateWorldAsync,
  type ArmComparison,
  type ArmConfig,
  type DecideFn,
  type DecisionRecord,
  type DecisionSource,
  type FundBrain,
  type ExperimentSpec,
  type ExperimentManifest,
  type ExperimentVariable,
  type RunResult,
} from '@black-sheep/engine/experiment';
import { FUND_PROFILES, getFundProfile } from '@black-sheep/engine/funds';
import { MODEL_REGISTRY } from '../config/models';
import {
  EXPERIMENT_MAX_ARMS,
  EXPERIMENT_MAX_BUDGET_USD,
  EXPERIMENT_MAX_SEEDS,
  EXPERIMENT_MAX_TICKS,
  EXPERIMENT_REPLAY_MAX_DECISIONS,
  EXPERIMENT_SERIES_POINTS,
  SNAPSHOT_EVERY_TICKS,
} from '../config/game';
import { estimateExperimentCostUsd, makeExperimentDecide, type ExperimentBudget } from './labBrain';
import type { CreateMessage } from './providers/anthropic';

/**
 * labCore — PURE Research Lab rules (VISION §10, D-032, D-033): validate an
 * experiment request, check the admin token, and run an experiment spec into
 * its stored result. No I/O except what is injected: the yield, and for model
 * brains the provider call (`create`) and the decision sink (`onDecision`).
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
  // A set: registry order, so the same roster listed twice in different orders is one arm.
  const order = (k: string) => FUND_PROFILES.findIndex((p) => p.key === k);
  return { ok: true, value: [...(x as string[])].sort((a, b) => order(a) - order(b)) };
}

function checkDirector(x: unknown): Check<ArmConfig['directorMode']> {
  return x === 'none' || x === 'rule' ? { ok: true, value: x } : fail(`Director mode must be 'none' or 'rule' (got ${String(x)}).`);
}

function checkCadence(x: unknown): Check<number | null> {
  if (x === null) return { ok: true, value: null };
  return isInt(x) && x >= 1 && x <= MAX_CADENCE ? { ok: true, value: x } : fail(`Decision cadence must be null or an integer 1–${MAX_CADENCE}.`);
}

/** Fund key -> 'policy' | model id. 'policy' entries are dropped: absent already means policy. */
function checkBrains(x: unknown): Check<Record<string, FundBrain>> {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return fail('Brains must be an object of fund key -> policy or a model id.');
  const out: Record<string, FundBrain> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!getFundProfile(k)) return fail(`Unknown fund key in brains: ${k}.`);
    if (v === 'policy') continue;
    if (typeof v !== 'string' || !Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, v)) return fail(`Unknown brain for ${k}: ${String(v)} (use 'policy' or a model id).`);
    out[k] = v as FundBrain;
  }
  return { ok: true, value: out };
}

const VALUE_CHECKS: Record<ExperimentVariable, (x: unknown) => Check<unknown>> = {
  directorMode: checkDirector,
  funds: checkFunds,
  decisionEveryTicks: checkCadence,
  brains: checkBrains,
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
  const config: ArmConfig = { funds: funds.value, directorMode: directorMode.value, decisionEveryTicks: cadence.value, ticks: b.ticks };
  if (b.brains === undefined) return { ok: true, value: config };
  const brains = checkBrains(b.brains);
  if (!brains.ok) return brains;
  // An all-policy map is left out, so the spec (and its configHash) equals one that never named brains.
  return { ok: true, value: Object.keys(brains.value).length ? { ...config, brains: brains.value } : config };
}

/**
 * Validate an untrusted create request. Everything a run needs is checked here, before anything is stored.
 * `providerConfigured`: whether the server holds a model provider key (model brains need one).
 */
export function parseExperimentRequest(
  body: unknown,
  opts: { providerConfigured: boolean },
): { ok: true; spec: ExperimentSpec } | { ok: false; error: string } {
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

  const budgetUsd = b.budgetUsd ?? null;
  if (budgetUsd !== null && !(typeof budgetUsd === 'number' && Number.isFinite(budgetUsd) && budgetUsd > 0 && budgetUsd <= EXPERIMENT_MAX_BUDGET_USD)) {
    return fail(`budgetUsd must be a number above 0 and at most $${EXPERIMENT_MAX_BUDGET_USD}.`);
  }

  const spec: ExperimentSpec = { name, base: base.value, variable, values, seeds: seeds as number[] };
  if (budgetUsd !== null) spec.budgetUsd = budgetUsd;
  if (hasModelBrains(spec)) {
    if (!opts.providerConfigured) return fail('Model brains need a provider key on the server.');
    if (budgetUsd === null) return fail(`budgetUsd is required when any fund uses a model (max $${EXPERIMENT_MAX_BUDGET_USD}).`);
  }
  return { ok: true, spec };
}

/** Validate a create request and price it (worst case) without storing anything: the form's live estimate. */
export function dryRunExperiment(
  body: unknown,
  opts: { providerConfigured: boolean },
): { ok: true; estimateUsd: number } | { ok: false; error: string } {
  const parsed = parseExperimentRequest(body, opts);
  return parsed.ok ? { ok: true, estimateUsd: estimateExperimentCostUsd(parsed.spec) } : parsed;
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
  /** Per-run fingerprints (rerunning a seed must reproduce its digest) and the series a replay draws. */
  runs: {
    label: string;
    runs: {
      seed: number;
      digest: string;
      liquidated: string[];
      /** Fund key -> NAV series, downsampled to EXPERIMENT_SERIES_POINTS. */
      navs: Record<string, number[]>;
      /** Always stored; absent in pre-Task-4 results and stripped from the detail payload (replay serves it). */
      events?: RunResult['events'];
      /** Fund key -> decision counts by source. */
      sources: Record<string, Record<DecisionSource, number>>;
      costUsd: number;
    }[];
  }[];
  /** Model spend actually incurred across every run; 0 for policy-only experiments. */
  costUsd: number;
  /** Worst-case model spend the spec allowed for (estimateExperimentCostUsd). */
  estimateUsd: number;
}

/** Whether any arm has a roster fund decided by a model. */
const hasModelBrains = (spec: ExperimentSpec) => expandArms(spec).some((a) => armModelFunds(a.config).length > 0);

/**
 * Run every arm on every seed; `yieldFn` runs between runs so the server's event loop stays responsive.
 * Arms with no model brain and no decision sink run the sync policy world; with a sink they run the async
 * world (identical digests) so every policy decision is reported too. Model arms call `deps.create`
 * against one budget shared by the whole experiment; a BudgetExhausted error ends the experiment.
 */
export async function runExperimentSpec(
  spec: ExperimentSpec,
  yieldFn: () => Promise<void>,
  deps?: { create: CreateMessage | null; onDecision?: (arm: string, seed: number, r: DecisionRecord) => Promise<void>; budget?: ExperimentBudget },
): Promise<ExperimentResult> {
  const estimateUsd = estimateExperimentCostUsd(spec);
  const create = deps?.create ?? null;
  if (hasModelBrains(spec) && !create) throw new Error('Model brains need a provider key on the server.');
  // A caller-owned budget lets the caller see the spend even when the run throws.
  const budget: ExperimentBudget = deps?.budget ?? { limitUsd: spec.budgetUsd ?? 0, spentUsd: 0 };
  const onDecision = deps?.onDecision;
  // Fresh per run (the gate state is per world). Policy funds never reach `decide`, so a policy-only arm needs no provider.
  const decideFor = (): DecideFn => (create ? makeExperimentDecide(create, budget) : () => Promise.reject(new Error('Model brains need a provider key on the server.')));
  const arms: { label: string; runs: RunResult[] }[] = [];
  for (const arm of expandArms(spec)) {
    const runs: RunResult[] = [];
    for (const seed of spec.seeds) {
      runs.push(
        armModelFunds(arm.config).length === 0 && !onDecision
          ? simulateWorld(arm.config, seed)
          : await simulateWorldAsync(arm.config, seed, decideFor(), onDecision && ((r) => onDecision(arm.label, seed, r))),
      );
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
      runs: a.runs.map((r) => ({
        seed: r.seed,
        digest: r.digest,
        liquidated: r.funds.filter((f) => f.liquidated).map((f) => f.key),
        navs: Object.fromEntries(r.funds.map((f) => [f.key, downsample(f.navs, EXPERIMENT_SERIES_POINTS)])),
        events: r.events,
        sources: Object.fromEntries(r.funds.map((f) => [f.key, f.sources])),
        costUsd: r.costUsd,
      })),
    })),
    costUsd: budget.spentUsd,
    estimateUsd,
  };
}

/** The stored Experiment row, as the route reads it. */
export interface ExperimentRow {
  id: number;
  createdAt: Date;
  name: string;
  status: string;
  variable: string;
  specJson: string;
  manifestJson: string;
  resultJson: string | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ExperimentSummary {
  id: number;
  name: string;
  status: string;
  variable: string;
  arms: number;
  seeds: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface ExperimentDetail extends ExperimentSummary {
  spec: ExperimentSpec | null;
  manifest: ExperimentManifest | null;
  result: ExperimentResult | null;
  error: string | null;
  startedAt: string | null;
}

/** Stored JSON is data: a corrupt column degrades to null, never a 500. */
function parseJson<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export type ExperimentSummaryRow = Pick<ExperimentRow, 'id' | 'createdAt' | 'name' | 'status' | 'variable' | 'specJson' | 'finishedAt'>;

export function buildExperimentSummary(row: ExperimentSummaryRow): ExperimentSummary {
  const spec = parseJson<ExperimentSpec>(row.specJson);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    variable: row.variable,
    arms: Array.isArray(spec?.values) ? spec.values.length : 0,
    seeds: Array.isArray(spec?.seeds) ? spec.seeds.length : 0,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

export function buildExperimentDetail(row: ExperimentRow): ExperimentDetail {
  const result = parseJson<ExperimentResult>(row.resultJson);
  // Per-run events are most of a large blob and polled; the replay route serves them one run at a time.
  if (Array.isArray(result?.runs)) {
    result.runs = result.runs.map((a) => ({ ...a, runs: Array.isArray(a.runs) ? a.runs.map((r) => ({ ...r, events: undefined })) : a.runs }));
  }
  return {
    ...buildExperimentSummary(row),
    spec: parseJson<ExperimentSpec>(row.specJson),
    manifest: parseJson<ExperimentManifest>(row.manifestJson),
    result,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
  };
}

export interface RunReplay {
  experimentId: number;
  arm: string;
  seed: number;
  /** Fund key -> NAV series (downsampled); navs[k] was recorded at tick navTicks[k]. */
  navs: Record<string, number[]>;
  /** Exact tick of every NAV point, so decisions and events line up with the series. */
  navTicks: number[];
  events: RunResult['events'];
  decisions: DecisionRecord[];
  /** More decisions exist than EXPERIMENT_REPLAY_MAX_DECISIONS; the tail is cut. */
  truncated: boolean;
  manifest: ExperimentManifest;
}

/**
 * Ticks of the stored NAV points. The engine records a NAV when the post-increment tick is a multiple of
 * SNAPSHOT_EVERY_TICKS (no tick-0 point), so raw point k sits at SNAPSHOT_EVERY_TICKS * (k + 1); stored
 * series are then thinned by the same downsampleIndex the engine's downsample uses.
 */
export function navTickAxis(ticks: number): number[] {
  const raw = Math.floor(ticks / SNAPSHOT_EVERY_TICKS);
  const at = (k: number) => SNAPSHOT_EVERY_TICKS * (k + 1);
  if (raw <= EXPERIMENT_SERIES_POINTS) return Array.from({ length: raw }, (_, k) => at(k));
  return Array.from({ length: EXPERIMENT_SERIES_POINTS }, (_, i) => at(downsampleIndex(i, raw, EXPERIMENT_SERIES_POINTS)));
}

/** The run's stored series for arm/seed, or null when the experiment has no such run or it predates navs/events (not replayable). */
export function findRun(row: ExperimentRow, arm: string, seed: number) {
  const result = parseJson<ExperimentResult>(row.resultJson);
  const run = result?.runs?.find((a) => a.label === arm)?.runs?.find((r) => r.seed === seed);
  return run && run.navs && Array.isArray(run.events) ? { ...run, events: run.events } : null;
}

/** One run of a finished experiment as the replay reads it; null for an unknown arm/seed or unfinished experiment. */
export function buildRunReplay(row: ExperimentRow, arm: string, seed: number, decisions: DecisionRecord[]): RunReplay | null {
  const run = findRun(row, arm, seed);
  const manifest = parseJson<ExperimentManifest>(row.manifestJson);
  if (!run || !manifest) return null;
  const ticks = parseJson<ExperimentSpec>(row.specJson)?.base.ticks ?? 0;
  return {
    experimentId: row.id,
    arm,
    seed,
    navs: run.navs,
    navTicks: navTickAxis(ticks),
    events: run.events,
    decisions: decisions.slice(0, EXPERIMENT_REPLAY_MAX_DECISIONS),
    truncated: decisions.length > EXPERIMENT_REPLAY_MAX_DECISIONS,
    manifest,
  };
}

/** A stored ExperimentDecision row back into the engine's DecisionRecord. */
export function decisionFromRow(r: {
  tick: number; fundKey: string; source: string; model: string | null; action: string; ticker: string | null;
  dollarAmount: number | null; confidence: number | null; reasoning: string; costUsd: number; inputTokens: number;
  outputTokens: number; latencyMs: number; toolCallsJson: string; outcome: string | null;
}): DecisionRecord {
  const calls = parseJson<{ name: string; ok: boolean }[]>(r.toolCallsJson);
  return {
    tick: r.tick,
    fundKey: r.fundKey,
    source: r.source as DecisionSource,
    model: r.model,
    decision: {
      action: r.action,
      ...(r.ticker !== null && { ticker: r.ticker }),
      ...(r.dollarAmount !== null && { dollarAmount: r.dollarAmount }),
      reasoning: r.reasoning,
      confidence: r.confidence ?? 0,
    } as DecisionRecord['decision'],
    costUsd: r.costUsd,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    latencyMs: r.latencyMs,
    toolCalls: Array.isArray(calls) ? calls : [],
    outcome: r.outcome,
  };
}
