/*
 * Black Sheep - controlled experiment worlds (VISION §10, Mode B). PURE.
 *
 * simulateWorld runs one complete, independent world headless and
 * fast-forwarded: the same engine calls, in the same order, as the live tick
 * in server/world.ts, but synchronous and with every fund on its
 * deterministic policy (no model calls — experiments are policy-only for now).
 * An experiment varies ONE variable across arms and runs every arm on the
 * same seeds, so arms are paired run for run.
 *
 * Reproducibility: (arm, seed) → identical prices, NAVs and decisions. The
 * digest hashes those numbers only; position ids and entry timestamps (which
 * portfolio.openPosition stamps with the wall clock) are excluded.
 */

import {
  DIRECTOR_EVERY_TICKS,
  DIRECTOR_OFFSET,
  EVENT_BUFFER,
  SNAPSHOT_EVERY_TICKS,
  STARTING_CAPITAL,
} from '../../../config/game';
import * as GAME_CONFIG from '../../../config/game';
import type { ModelId } from '../../../config/models';
import { buildDirectorEvent, isMajorEvent, observeWorld, ruleDirector, validateIntervention } from './director';
import { generateEvent, initialScheduler, maybeFireScriptedEvent, type SchedulerState } from './events';
import { FUND_PROFILES, getFundProfile, type FundProfile } from './funds';
import { applyEvent, applyTrade, createInitialMarket, mulberry32, tickMarket } from './market';
import { seriesMetrics } from './metrics';
import { decideByPolicy, enforceRiskLimit } from './policies';
import { checkLiquidation, liquidateFund, markToMarket } from './portfolio';
import { bootstrapMeanCI, holm, signTestP } from './stats';
import {
  applyRivalDecision,
  buildDecisionInput,
  createRivalFund,
  type RivalDecision,
  type RivalDecisionInput,
  type RivalFund,
} from './rival';
import type { MarketEvent, MarketState } from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Who decides for a fund: its deterministic policy, or a model. */
export type FundBrain = 'policy' | ModelId;

export interface ArmConfig {
  /** Registry fund keys present in this world. */
  funds: string[];
  /** 'jev' is not offered: the Jev adapter is a stub (D-029). */
  directorMode: 'none' | 'rule';
  /** Every fund's decision cadence; null keeps each registry cadence. */
  decisionEveryTicks: number | null;
  ticks: number;
  /** Fund key -> brain; a missing key (or the whole map) means 'policy'. */
  brains?: Record<string, FundBrain>;
}

export const EXPERIMENT_VARIABLES = ['directorMode', 'funds', 'decisionEveryTicks', 'brains'] as const;
export type ExperimentVariable = (typeof EXPERIMENT_VARIABLES)[number];

export interface ExperimentSpec {
  name: string;
  base: ArmConfig;
  variable: ExperimentVariable;
  /** One arm per value; each fund's baseline is the first arm that contains it. */
  values: unknown[];
  seeds: number[];
  /** Hard USD cap on model calls across the whole experiment; absent/null when every fund is on its policy. */
  budgetUsd?: number | null;
}

export function armLabel(variable: ExperimentVariable, value: unknown): string {
  if (Array.isArray(value)) return `${variable}=${value.join('+')}`;
  // A brains map: fund:brain pairs; an empty map is the all-policy arm.
  if (value && typeof value === 'object') {
    const pairs = Object.entries(value).map(([k, v]) => `${k}:${String(v)}`);
    return `${variable}=${pairs.length ? pairs.join('+') : 'policy'}`;
  }
  return `${variable}=${String(value)}`;
}

export function expandArms(spec: ExperimentSpec): { label: string; config: ArmConfig }[] {
  return spec.values.map((value) => ({
    label: armLabel(spec.variable, value),
    config: { ...spec.base, [spec.variable]: value } as ArmConfig,
  }));
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type DecisionSource = 'policy' | 'llm' | 'fallback';

export interface DecisionRecord {
  tick: number;
  fundKey: string;
  source: DecisionSource;
  model: string | null;
  decision: RivalDecision;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolCalls: { name: string; ok: boolean }[];
  outcome: string | null;
}

export type DecideFn = (ctx: { fund: SimFund; input: RivalDecisionInput; tick: number }) => Promise<Omit<DecisionRecord, 'tick' | 'fundKey'>>;

export interface SimFund {
  profile: FundProfile;
  every: number;
  offset: number;
  fund: RivalFund;
  liquidated: boolean;
  liquidatedAtTick: number | null;
  navs: number[];
  decisions: number;
  trades: number;
  brain: FundBrain;
  sources: Record<DecisionSource, number>;
}

export interface SimState {
  seed: number;
  directorMode: ArmConfig['directorMode'];
  market: MarketState;
  scheduler: SchedulerState;
  /** Newest first, capped at EVENT_BUFFER (what funds see). */
  recentEvents: MarketEvent[];
  log: { tick: number; type: string; priceImpactPercent: number; director: boolean }[];
  lastEventTick: number | null;
  lastInterventionTick: number | null;
  directorInterventions: number;
  funds: SimFund[];
}

/** Registry order: the live world's fund-id order, so the order a roster is listed in never matters. */
const registryRank = (key: string) => FUND_PROFILES.findIndex((p) => p.key === key);

export function initialSimState(arm: ArmConfig, seed: number): SimState {
  const keys = [...arm.funds].sort((a, b) => registryRank(a) - registryRank(b));
  const funds = keys.map((key): SimFund => {
    const profile = getFundProfile(key);
    if (!profile) throw new Error(`Unknown fund key: ${key}`);
    const every = arm.decisionEveryTicks ?? profile.decisionEveryTicks;
    return {
      profile,
      every,
      offset: profile.decisionOffset % every,
      fund: createRivalFund(STARTING_CAPITAL, profile.personality),
      liquidated: false,
      liquidatedAtTick: null,
      navs: [],
      decisions: 0,
      trades: 0,
      brain: arm.brains?.[key] ?? 'policy',
      sources: { policy: 0, llm: 0, fallback: 0 },
    };
  });
  return {
    seed,
    directorMode: arm.directorMode,
    market: createInitialMarket(),
    scheduler: initialScheduler(),
    recentEvents: [],
    log: [],
    lastEventTick: null,
    lastInterventionTick: null,
    directorInterventions: 0,
    funds,
  };
}

/** Market, events, director, liquidations and NAV snapshots for one tick (server/world.ts tickWorld). */
export function advanceTick(s: SimState): void {
  const rng = mulberry32((s.seed ^ Math.imul(s.market.tickCount + 1, 0x85ebca6b)) >>> 0);
  let next = tickMarket(s.market, s.seed);
  const scripted = maybeFireScriptedEvent(next, s.scheduler, rng);
  let evt: MarketEvent | null = scripted.event;
  s.scheduler = scripted.next;
  if (!evt) evt = generateEvent(next, rng);
  if (evt) next = applyEvent(next, evt) as MarketState;

  let directorEvt: MarketEvent | null = null;
  if (s.directorMode === 'rule' && next.tickCount % DIRECTOR_EVERY_TICKS === DIRECTOR_OFFSET) {
    const alive = s.funds.filter((f) => !f.liquidated).length;
    const obs = observeWorld({
      market: next,
      lastEventTick: s.lastEventTick,
      lastInterventionTick: s.lastInterventionTick,
      eventFiredThisTick: evt !== null,
      fundsAlive: alive,
      fundsTotal: s.funds.length,
    });
    const intervention = validateIntervention(ruleDirector(obs).intervention, obs);
    const drng = mulberry32((s.seed ^ 0x9e3779b9 ^ Math.imul(next.tickCount + 1, 0x85ebca6b)) >>> 0);
    directorEvt = buildDirectorEvent(intervention, next, drng);
    if (directorEvt) {
      next = applyEvent(next, directorEvt) as MarketState;
      s.lastInterventionTick = next.tickCount;
      s.directorInterventions++;
    }
  }
  s.market = next;

  // Liquidation: every live fund with a margin breach is force-closed.
  for (const f of s.funds) {
    if (f.liquidated || f.fund.positions.length === 0) continue;
    if (!checkLiquidation(f.fund, s.market).atRisk) continue;
    f.fund = { ...f.fund, ...liquidateFund(f.fund, s.market) };
    f.liquidated = true;
    f.liquidatedAtTick = s.market.tickCount;
  }

  for (const e of [evt, directorEvt]) {
    if (!e) continue;
    s.recentEvents = [e, ...s.recentEvents].slice(0, EVENT_BUFFER);
    s.log.push({ tick: s.market.tickCount, type: e.type, priceImpactPercent: e.priceImpactPercent, director: e === directorEvt });
    if (isMajorEvent(e)) s.lastEventTick = s.market.tickCount;
  }

  if (s.market.tickCount % SNAPSHOT_EVERY_TICKS === 0) {
    for (const f of s.funds) f.navs.push(markToMarket(f.fund, s.market).nav);
  }
}

/** Funds whose decision slot is this tick, never once liquidated. */
function decidingFunds(s: SimState): SimFund[] {
  const t = s.market.tickCount;
  return s.funds.filter((f) => !f.liquidated && t !== 0 && t % f.every === f.offset);
}

/**
 * Apply decisions one after another, in registry order, on the moving market.
 * Every fund deciding this tick read the same pre-trade market (as in the live world).
 */
export function applyDecisions(s: SimState, decided: { f: SimFund; decision: RivalDecision }[]): void {
  for (const { f, decision } of decided) {
    f.decisions++;
    let market = s.market;
    if ((decision.action === 'buy' || decision.action === 'short') && decision.ticker && decision.dollarAmount) {
      const impacted = applyTrade(market, decision.ticker, decision.dollarAmount, decision.action === 'buy' ? 'buy' : 'sell');
      market = { ...market, companies: impacted.companies, recentFlow: impacted.recentFlow };
    }
    const after = applyRivalDecision(f.fund, decision, market);
    if (after.positions !== f.fund.positions) f.trades++;
    f.fund = after;
    s.market = market;
  }
}

/** One synchronous tick with every fund on its policy. */
export function stepWorld(s: SimState): void {
  advanceTick(s);
  const decided = decidingFunds(s).map((f) => {
    const input = buildDecisionInput(f.fund, s.market, s.recentEvents, s.market.recentFlow);
    f.sources.policy++;
    return { f, decision: enforceRiskLimit(decideByPolicy(f.profile, input), input, f.profile) };
  });
  applyDecisions(s, decided);
}

export interface RunResult {
  seed: number;
  funds: {
    key: string;
    name: string;
    navs: number[];
    liquidated: boolean;
    liquidatedAtTick: number | null;
    decisions: number;
    trades: number;
    sources: Record<DecisionSource, number>;
  }[];
  events: { tick: number; type: string; priceImpactPercent: number; director: boolean }[];
  directorInterventions: number;
  /** Sum of model-call costs; 0 for policy-only runs. */
  costUsd: number;
  /** fnv1a of final prices and every NAV series: equal digests = the same world. */
  digest: string;
}

export function simulateWorld(arm: ArmConfig, seed: number): RunResult {
  const s = initialSimState(arm, seed);
  for (let i = 0; i < arm.ticks; i++) stepWorld(s);
  return summarize(s, 0);
}

/**
 * Same world, but funds with a model brain decide through the injected `decide`
 * (sequentially, registry order). The model proposes, the risk limit disposes.
 * Policy funds never touch `decide`.
 */
export async function simulateWorldAsync(
  arm: ArmConfig,
  seed: number,
  decide: DecideFn,
  onDecision?: (r: DecisionRecord) => void | Promise<void>,
): Promise<RunResult> {
  const s = initialSimState(arm, seed);
  let costUsd = 0;
  for (let i = 0; i < arm.ticks; i++) {
    advanceTick(s);
    const tick = s.market.tickCount;
    const inputs = decidingFunds(s).map((f) => ({ f, input: buildDecisionInput(f.fund, s.market, s.recentEvents, s.market.recentFlow) }));
    const decided: { f: SimFund; decision: RivalDecision }[] = [];
    for (const { f, input } of inputs) {
      const out: Omit<DecisionRecord, 'tick' | 'fundKey'> =
        f.brain === 'policy'
          ? { source: 'policy', model: null, decision: decideByPolicy(f.profile, input), costUsd: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0, toolCalls: [], outcome: null }
          : await decide({ fund: f, input, tick });
      const decision = enforceRiskLimit(out.decision, input, f.profile);
      f.sources[out.source]++;
      costUsd += out.costUsd;
      decided.push({ f, decision });
      await onDecision?.({ ...out, decision, tick, fundKey: f.profile.key });
    }
    applyDecisions(s, decided);
  }
  return summarize(s, costUsd);
}

function summarize(s: SimState, costUsd: number): RunResult {
  const seed = s.seed;
  const funds = s.funds.map((f) => ({
    key: f.profile.key,
    name: f.profile.name,
    navs: f.navs,
    liquidated: f.liquidated,
    liquidatedAtTick: f.liquidatedAtTick,
    decisions: f.decisions,
    trades: f.trades,
    sources: f.sources,
  }));
  const prices = Object.fromEntries(Object.values(s.market.companies).map((c) => [c.ticker, c.price]));
  return {
    seed,
    funds,
    events: s.log,
    directorInterventions: s.directorInterventions,
    costUsd,
    digest: fnv1a(canonicalJson({ prices, navs: funds.map((f) => f.navs), tick: s.market.tickCount })),
  };
}

// ---------------------------------------------------------------------------
// Reproducibility metadata
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 32-bit FNV-1a as 8 hex chars. An integrity fingerprint, not a security hash. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ExperimentManifest {
  configHash: string;
  /** Every registry profile (mandate, strategy, limits, cadence) as it was. */
  fundProfileHashes: Record<string, string>;
  /** Every tuning constant in config/game.ts. */
  worldConstantsHash: string;
  seeds: number[];
  engine: 'black-sheep-engine';
  policyOnly: true;
}

export function experimentManifest(spec: ExperimentSpec): ExperimentManifest {
  return {
    configHash: fnv1a(canonicalJson(spec)),
    fundProfileHashes: Object.fromEntries(FUND_PROFILES.map((p) => [p.key, fnv1a(canonicalJson(p))])),
    worldConstantsHash: fnv1a(canonicalJson({ ...GAME_CONFIG })),
    seeds: spec.seeds,
    engine: 'black-sheep-engine',
    policyOnly: true,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface Stat {
  mean: number | null;
  /** Sample standard deviation; null below two values. */
  std: number | null;
}

export interface FundArmStats {
  key: string;
  name: string;
  n: number;
  totalReturn: Stat;
  /** Percentile bootstrap 95% CI of the mean total return; null below two runs. */
  totalReturnCI: [number, number] | null;
  maxDrawdown: Stat;
  sharpe: Stat;
  /** Share of runs the fund survived. */
  survival: number;
  /** Paired by seed against this fund's baseline arm; null in the baseline arm itself. */
  vsBaseline: {
    meanDiff: number;
    wins: number;
    pairs: number;
    ci: [number, number] | null;
    /** Exact two-sided sign test on non-tied pairs. */
    pSign: number;
    /** pSign Holm-adjusted across every vsBaseline in the comparison. */
    pHolm: number;
  } | null;
  /** The first arm containing this fund (a mixed world is compared with the fund alone). */
  baselineLabel: string | null;
}

export interface ArmComparison {
  label: string;
  funds: FundArmStats[];
  meanEvents: number;
  meanDirectorInterventions: number;
  /** fallback / (llm + fallback) over the arm's decisions; null with no model brains. */
  fallbackRate: number | null;
  meanCostUsd: number;
}

function stat(xs: (number | null)[]): Stat {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length === 0) return { mean: null, std: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length < 2) return { mean, std: null };
  return { mean, std: Math.sqrt(v.reduce((a, x) => a + (x - mean) ** 2, 0) / (v.length - 1)) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function compareArms(arms: { label: string; runs: RunResult[] }[], startingCapital = STARTING_CAPITAL): ArmComparison[] {
  const returnsBySeed = (runs: RunResult[], key: string) =>
    new Map(runs.map((r) => [r.seed, seriesMetrics(r.funds.find((f) => f.key === key)?.navs ?? [], startingCapital).totalReturn]));

  const out = arms.map((arm, i) => {
    const keys = [...new Set(arm.runs.flatMap((r) => r.funds.map((f) => f.key)))];
    const funds = keys.map((key): FundArmStats => {
      const runs = arm.runs.map((r) => r.funds.find((f) => f.key === key)).filter((f) => f !== undefined);
      const m = runs.map((f) => seriesMetrics(f.navs, startingCapital));
      let vsBaseline: FundArmStats['vsBaseline'] = null;
      const baselineIndex = arms.findIndex((a) => a.runs.some((r) => r.funds.some((f) => f.key === key)));
      const baseline = baselineIndex >= 0 && baselineIndex < i ? arms[baselineIndex] : null;
      if (baseline) {
        const base = returnsBySeed(baseline.runs, key);
        const mine = returnsBySeed(arm.runs, key);
        const diffs: number[] = [];
        for (const [seed, r] of mine) {
          const b = base.get(seed);
          if (r !== null && r !== undefined && b !== null && b !== undefined) diffs.push(r - b);
        }
        if (diffs.length) {
          const wins = diffs.filter((d) => d > 0).length;
          const decisive = diffs.filter((d) => d !== 0).length;
          // pHolm is filled in below, once every arm's p-value is known.
          vsBaseline = { meanDiff: mean(diffs), wins, pairs: diffs.length, ci: bootstrapMeanCI(diffs), pSign: signTestP(wins, decisive), pHolm: 1 };
        }
      }
      return {
        key,
        name: runs[0]?.name ?? key,
        n: runs.length,
        totalReturn: stat(m.map((x) => x.totalReturn)),
        totalReturnCI: bootstrapMeanCI(m.map((x) => x.totalReturn).filter((x): x is number => x !== null && Number.isFinite(x))),
        maxDrawdown: stat(m.map((x) => x.maxDrawdown)),
        sharpe: stat(m.map((x) => x.sharpe)),
        survival: runs.length ? runs.filter((f) => !f.liquidated).length / runs.length : 0,
        vsBaseline,
        baselineLabel: baseline?.label ?? null,
      };
    });
    const sources = arm.runs.flatMap((r) => r.funds.map((f) => f.sources));
    const fallback = sources.reduce((a, s) => a + s.fallback, 0);
    const modelCalls = fallback + sources.reduce((a, s) => a + s.llm, 0);
    return {
      label: arm.label,
      funds,
      meanEvents: mean(arm.runs.map((r) => r.events.length)),
      meanDirectorInterventions: mean(arm.runs.map((r) => r.directorInterventions)),
      fallbackRate: modelCalls > 0 ? fallback / modelCalls : null,
      meanCostUsd: mean(arm.runs.map((r) => r.costUsd)),
    };
  });
  const tested = out.flatMap((a) => a.funds).flatMap((f) => (f.vsBaseline ? [f.vsBaseline] : []));
  holm(tested.map((v) => v.pSign)).forEach((p, i) => (tested[i].pHolm = p));
  return out;
}

/** At most n evenly spaced points, always keeping the first and last. */
export function downsample(xs: number[], n: number): number[] {
  if (xs.length <= n) return xs;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (n - 1))]);
  return out;
}
