import { expandArms, experimentManifest, type ExperimentSpec } from '@black-sheep/engine/experiment';
import type { Behaviour } from '@black-sheep/engine/behaviour';
import { seriesMetrics } from '@black-sheep/engine/metrics';
import { mulberry32 } from '@black-sheep/engine/market';
import { bootstrapMeanCI, holm, signTestP } from '@black-sheep/engine/stats';
import { STARTING_CAPITAL } from '../config/game';
import type { ExperimentResult } from './labCore';

export interface StudyRow {
  hypothesis: string;
  experimentId: number;
  configHash: string;
  arm: string;
  fundKey: string;
  seed: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  survived: boolean;
  fallbackRate: number | null;
  costUsd: number;
  decisions: number;
  behaviour: Behaviour;
}

export interface Contrast {
  arm: string;
  n: number;
  meanDiff: number;
  ci: [number, number];
  pSign: number;
  pHolm: number;
}

const BEHAVIOUR_KEYS: (keyof Behaviour)[] = ['actionEntropy', 'riskCompliance', 'repeatedErrorRate', 'shockDeRisk', 'tradeRate'];
const NULL_BEHAVIOUR: Behaviour = { actionEntropy: null, riskCompliance: null, repeatedErrorRate: null, shockDeRisk: null, tradeRate: null };

function parse<T>(json: unknown): T | null {
  try {
    return typeof json === 'string' ? (JSON.parse(json) as T) : ((json as T) ?? null);
  } catch {
    return null;
  }
}

/** Per-fund-run rows of every `study:<H>:...` experiment; malformed or non-study experiments are skipped. */
export function studyRows(experiments: { id: number; name: string; resultJson: unknown; specJson: unknown }[]): StudyRow[] {
  const out: StudyRow[] = [];
  for (const e of experiments) {
    const hypothesis = /^study:([^:]+):/.exec(e.name)?.[1];
    const spec = parse<ExperimentSpec>(e.specJson);
    const result = parse<ExperimentResult>(e.resultJson);
    if (!hypothesis || !spec || !result || !Array.isArray(result.runs)) continue;
    let arms: ReturnType<typeof expandArms>;
    let configHash: string;
    try {
      arms = expandArms(spec);
      configHash = experimentManifest(spec).configHash;
    } catch {
      continue;
    }
    // Subjects: funds with a non-policy brain in some arm (same rule as leaderboardCore).
    const modelFunds = new Set(arms.flatMap((a) => Object.entries(a.config.brains ?? {}).filter(([, b]) => b !== 'policy').map(([f]) => f)));
    for (const arm of result.runs) {
      for (const run of arm.runs ?? []) {
        if (!run.navs) continue;
        // A hypothesis with no model funds (policy-only test experiment): every fund is a subject so contrasts still work.
        const subjects = modelFunds.size > 0 ? [...modelFunds] : Object.keys(run.navs);
        for (const fund of subjects) {
          // Prefer full-resolution stored metrics; the downsampled navs only serve older rows.
          const sm = run.metrics?.[fund];
          const nm = run.navs[fund] && seriesMetrics(run.navs[fund], STARTING_CAPITAL);
          const met = sm ?? (nm && nm.totalReturn !== null ? { totalReturnPct: nm.totalReturn * 100, maxDrawdownPct: nm.maxDrawdown * 100, sharpe: nm.sharpe } : null);
          if (!met || !Number.isFinite(met.totalReturnPct)) continue;
          const src = run.sources?.[fund];
          const model = src ? src.llm + src.fallback : 0;
          const behaviour = run.behaviour?.[fund] ?? NULL_BEHAVIOUR;
          out.push({
            hypothesis,
            experimentId: e.id,
            configHash,
            arm: arm.label,
            fundKey: fund,
            seed: run.seed,
            totalReturnPct: met.totalReturnPct,
            maxDrawdownPct: met.maxDrawdownPct,
            sharpe: met.sharpe,
            survived: !(run.liquidated ?? []).includes(fund),
            fallbackRate: model > 0 ? src!.fallback / model : null,
            // shortcut: run cost goes to the subject fund, exact with one model fund per arm (as the leaderboard)
            costUsd: run.costUsd ?? 0,
            decisions: src ? src.llm + src.fallback + src.policy : 0,
            behaviour,
          });
        }
      }
    }
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Paired return differences (arm minus baseline) on subject funds, pooled across the hypothesis's experiments, Holm across arms. */
export function pairedContrasts(rows: StudyRow[], hypothesis: string, baselineArm: string): Contrast[] {
  const mine = rows.filter((r) => r.hypothesis === hypothesis);
  // Pairs stay inside one experiment; seed blocks are disjoint, so pooling still gives one pair per seed.
  const key = (r: StudyRow) => `${r.experimentId}|${r.fundKey}|${r.seed}`;
  const base = new Map(mine.filter((r) => r.arm === baselineArm).map((r) => [key(r), r.totalReturnPct]));
  const armNames = [...new Set(mine.map((r) => r.arm))].filter((a) => a !== baselineArm);
  const partial = armNames.flatMap((arm) => {
    const diffs = mine.flatMap((r) => (r.arm === arm && base.has(key(r)) ? [r.totalReturnPct - base.get(key(r))!] : []));
    if (diffs.length === 0) return [];
    const nonTies = diffs.filter((d) => d !== 0);
    const m = mean(diffs);
    return [{ arm, n: diffs.length, meanDiff: m, ci: bootstrapMeanCI(diffs) ?? ([m, m] as [number, number]), pSign: signTestP(nonTies.filter((d) => d > 0).length, nonTies.length) }];
  });
  const adj = holm(partial.map((p) => p.pSign));
  return partial.map((p, i) => ({ ...p, pHolm: adj[i] }));
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: StudyRow[]): string {
  const head = [
    'hypothesis', 'experimentId', 'configHash', 'arm', 'fundKey', 'seed', 'totalReturnPct', 'maxDrawdownPct', 'sharpe',
    'survived', 'fallbackRate', 'costUsd', 'decisions', ...BEHAVIOUR_KEYS.map((k) => `behaviour_${k}`),
  ];
  const lines = rows.map((r) =>
    [r.hypothesis, r.experimentId, r.configHash, r.arm, r.fundKey, r.seed, r.totalReturnPct, r.maxDrawdownPct, r.sharpe, r.survived, r.fallbackRate, r.costUsd, r.decisions, ...BEHAVIOUR_KEYS.map((k) => r.behaviour[k])]
      .map(csvCell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n') + '\n';
}

const f2 = (x: number) => x.toFixed(2);
const f4 = (x: number) => x.toFixed(4);
const TEX_SPECIAL: Record<string, string> = { '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' };
const texEsc = (s: string) => s.replace(/[\\&%$#_{}^~]/g, (c) => TEX_SPECIAL[c] ?? `\\${c}`);

export function texTable(contrasts: Contrast[], caption: string, label: string, tag: string): string {
  const body = contrasts.map((c) => `${texEsc(c.arm)} & ${c.n} & ${f2(c.meanDiff)} & ${c.n < 2 ? '—' : `[${f2(c.ci[0])}, ${f2(c.ci[1])}]`} & ${f4(c.pSign)} & ${f4(c.pHolm)} \\\\`);
  return [
    `% ${tag}`,
    '\\begin{table}[ht]',
    '\\centering',
    '\\begin{tabular}{lrrrrr}',
    '\\toprule',
    'Arm & $n$ & Mean diff (pp) & 95\\% CI & $p$ (sign) & $p$ (Holm) \\\\',
    '\\midrule',
    ...body,
    '\\bottomrule',
    '\\end{tabular}',
    `\\caption{${texEsc(caption)}}`,
    `\\label{${label}}`,
    '\\end{table}',
    '',
  ].join('\n');
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function svgForest(contrasts: Contrast[], title: string, tag: string): string {
  const W = 640;
  const H = 80 + 40 * contrasts.length;
  const [L, R] = [200, 620];
  const lo = Math.min(0, ...contrasts.map((c) => c.ci[0]));
  const hi = Math.max(0, ...contrasts.map((c) => c.ci[1]));
  const span = hi - lo || 1;
  const x = (v: number) => f2(L + ((v - lo) / span) * (R - L));
  const rows = contrasts.map((c, i) => {
    const y = 80 + 40 * i;
    return [
      `<text x="10" y="${y + 4}" font-size="12" font-family="sans-serif">${xmlEsc(c.arm)}</text>`,
      `<line x1="${x(c.ci[0])}" y1="${y}" x2="${x(c.ci[1])}" y2="${y}" stroke="#333" stroke-width="2"/>`,
      `<circle cx="${x(c.meanDiff)}" cy="${y}" r="5" fill="#1f77b4"/>`,
    ].join('\n');
  });
  return [
    `<!-- ${tag} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<text x="10" y="24" font-size="14" font-weight="bold" font-family="sans-serif">${xmlEsc(title)}</text>`,
    `<line x1="${x(0)}" y1="44" x2="${x(0)}" y2="${H - 20}" stroke="#999" stroke-dasharray="4 3"/>`,
    ...rows,
    `<text x="${x(lo)}" y="${H - 4}" font-size="10" font-family="sans-serif">${f2(lo)}</text>`,
    `<text x="${x(hi)}" y="${H - 4}" font-size="10" font-family="sans-serif" text-anchor="end">${f2(hi)}</text>`,
    '</svg>',
    '',
  ].join('\n');
}

const PALETTE = ['#1f77b4', '#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b'];

export function svgReturnSeries(series: { label: string; points: number[] }[], title: string, tag: string): string {
  const [W, H, L, R, T, B] = [640, 360, 50, 620, 40, 320];
  const all = series.flatMap((s) => s.points);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const span = hi - lo || 1;
  const lines = series.map((s, i) => {
    const px = (j: number) => f2(L + (s.points.length > 1 ? (j / (s.points.length - 1)) * (R - L) : 0));
    const pts = s.points.map((v, j) => `${px(j)},${f2(B - ((v - lo) / span) * (B - T))}`).join(' ');
    const c = PALETTE[i % PALETTE.length];
    return [
      `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2"/>`,
      `<text x="${L + 10}" y="${T + 14 * (i + 1)}" font-size="11" font-family="sans-serif" fill="${c}">${xmlEsc(s.label)}</text>`,
    ].join('\n');
  });
  return [
    `<!-- ${tag} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<text x="10" y="24" font-size="14" font-weight="bold" font-family="sans-serif">${xmlEsc(title)}</text>`,
    `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#999"/>`,
    `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#999"/>`,
    `<text x="${L - 4}" y="${T + 4}" font-size="10" font-family="sans-serif" text-anchor="end">${f2(hi)}</text>`,
    `<text x="${L - 4}" y="${B}" font-size="10" font-family="sans-serif" text-anchor="end">${f2(lo)}</text>`,
    ...lines,
    '</svg>',
    '',
  ].join('\n');
}

type StoredExperiment = { id: number; name: string; resultJson: unknown; specJson: unknown; manifestJson?: unknown; status?: string; error?: string | null };

const isStudy = (e: StoredExperiment) => e.name.startsWith('study:');

/** The refusal shared by the exporter and the study runner. */
export const preregMismatch = (id: number, name: string, stored: string | null, spec: string) =>
  `Experiment #${id} '${name}' does not match its pre-registered spec (configHash ${stored} ≠ ${spec}).`;

/**
 * Only the pre-registered set (PREREGISTRATION: the committed paper/study/*.json) is analysed:
 * a study row is kept when its name is a spec's and its stored configHash equals that spec's.
 * `study:*` rows with no spec are returned as unmatched; a named row with another hash is an error.
 */
export function matchPreregistered(
  experiments: StoredExperiment[],
  specs: { name: string; configHash: string }[],
): { ok: true; matched: StoredExperiment[]; unmatched: StoredExperiment[] } | { ok: false; error: string } {
  const hashOf = new Map(specs.map((s) => [s.name, s.configHash]));
  const matched: StoredExperiment[] = [];
  const unmatched: StoredExperiment[] = [];
  for (const e of experiments) {
    if (!isStudy(e)) continue;
    const want = hashOf.get(e.name);
    if (want === undefined) {
      unmatched.push(e);
      continue;
    }
    const stored = parse<{ configHash?: string }>(e.manifestJson)?.configHash ?? null;
    if (stored !== want) return { ok: false, error: preregMismatch(e.id, e.name, stored, want) };
    matched.push(e);
  }
  return { ok: true, matched, unmatched };
}

/**
 * Resubmission rule (PREREGISTRATION amendment 1): per study name only the newest done experiment counts.
 * Rows without a status are treated as done (callers that load done rows only).
 */
export function latestDoneStudy(experiments: StoredExperiment[]): { kept: StoredExperiment[]; ignored: StoredExperiment[] } {
  const newest = new Map<string, StoredExperiment>();
  for (const e of experiments) {
    if (!isStudy(e) || (e.status ?? 'done') !== 'done') continue;
    const cur = newest.get(e.name);
    if (!cur || e.id > cur.id) newest.set(e.name, e);
  }
  const keep = new Set(newest.values());
  return {
    kept: experiments.filter((e) => keep.has(e)),
    ignored: experiments.filter((e) => isStudy(e) && (e.status ?? 'done') === 'done' && !keep.has(e)),
  };
}

/** Every failed study experiment with its error: PREREGISTRATION lists them rather than excluding silently. */
export function failedCsv(experiments: StoredExperiment[]): string {
  const lines = experiments.filter((e) => isStudy(e) && e.status === 'failed').map((e) => [e.id, e.name, e.error ?? ''].map(csvCell).join(','));
  return ['experimentId,name,error', ...lines].join('\n') + '\n';
}

export interface CostQuality {
  arm: string;
  n: number;
  meanDiff: number;
  meanCostUsd: number;
  /** Mean paired return difference (pp) per mean USD per run; null when the arm spent nothing. */
  ppPerUsd: number | null;
  ci: [number, number] | null;
}

/**
 * H4 (PREREGISTRATION amendment 1): per model arm, mean paired return difference vs the baseline (pp)
 * divided by the arm's mean cost per run (USD), with a seeded percentile bootstrap over seed pairs
 * (2000 iterations, seed 1, as bootstrapMeanCI). A resample whose mean cost is $0 is dropped.
 */
export function costQuality(rows: StudyRow[], hypothesis: string, baselineArm: string, { iters = 2000, seed = 1 } = {}): CostQuality[] {
  const mine = rows.filter((r) => r.hypothesis === hypothesis);
  const key = (r: StudyRow) => `${r.experimentId}|${r.fundKey}|${r.seed}`;
  const base = new Map(mine.filter((r) => r.arm === baselineArm).map((r) => [key(r), r.totalReturnPct]));
  const armNames = [...new Set(mine.map((r) => r.arm))].filter((a) => a !== baselineArm);
  return armNames.flatMap((arm) => {
    const pairs = mine.flatMap((r) => (r.arm === arm && base.has(key(r)) ? [{ d: r.totalReturnPct - base.get(key(r))!, c: r.costUsd }] : []));
    if (pairs.length === 0) return [];
    const n = pairs.length;
    const meanDiff = mean(pairs.map((p) => p.d));
    const meanCostUsd = mean(pairs.map((p) => p.c));
    let ci: [number, number] | null = null;
    if (n >= 2) {
      const rand = mulberry32(seed);
      const stats: number[] = [];
      for (let i = 0; i < iters; i++) {
        let sd = 0;
        let sc = 0;
        for (let j = 0; j < n; j++) {
          const p = pairs[Math.floor(rand() * n)];
          sd += p.d;
          sc += p.c;
        }
        if (sc > 0) stats.push(sd / sc);
      }
      stats.sort((a, b) => a - b);
      const at = (q: number) => stats[Math.min(stats.length - 1, Math.max(0, Math.floor(q * stats.length)))];
      if (stats.length) ci = [at(0.025), at(0.975)];
    }
    return [{ arm, n, meanDiff, meanCostUsd, ppPerUsd: meanCostUsd > 0 ? meanDiff / meanCostUsd : null, ci }];
  });
}

export function texH4Table(rows: CostQuality[], caption: string, label: string, tag: string): string {
  const body = rows.map(
    (r) => `${texEsc(r.arm)} & ${r.n} & ${f2(r.meanDiff)} & ${f4(r.meanCostUsd)} & ${r.ppPerUsd === null ? '—' : f2(r.ppPerUsd)} & ${r.ci ? `[${f2(r.ci[0])}, ${f2(r.ci[1])}]` : '—'} \\\\`,
  );
  return [
    `% ${tag}`,
    '\\begin{table}[ht]',
    '\\centering',
    '\\begin{tabular}{lrrrrr}',
    '\\toprule',
    'Arm & $n$ & Mean diff (pp) & Mean cost (\\$/run) & pp per \\$ & 95\\% CI \\\\',
    '\\midrule',
    ...body,
    '\\bottomrule',
    '\\end{tabular}',
    `\\caption{${texEsc(caption)}}`,
    `\\label{${label}}`,
    '\\end{table}',
    '',
  ].join('\n');
}

/** Every file the paper needs (path relative to the repo root), built from finished `study:*` experiments (pass matchPreregistered's `matched`). */
export function buildPaperFiles(all: StoredExperiment[]): { path: string; content: string }[] {
  const experiments = latestDoneStudy(all).kept;
  const rows = studyRows(experiments);
  const files = [
    { path: 'paper/data/study.csv', content: toCsv(rows) },
    { path: 'paper/data/failed.csv', content: failedCsv(all) },
  ];
  for (const h of [...new Set(rows.map((r) => r.hypothesis))].sort()) {
    const mine = experiments.filter((e) => e.name.startsWith(`study:${h}:`) && rows.some((r) => r.experimentId === e.id));
    const tag = `exp=${mine.map((e) => e.id).join(',')} cfg=${[...new Set(rows.filter((r) => r.hypothesis === h).map((r) => r.configHash))].join(',')}`;
    // The baseline is the first arm of the spec (existing convention).
    const baseline = expandArms(parse<ExperimentSpec>(mine[0].specJson)!)[0].label;
    const contrasts = pairedContrasts(rows, h, baseline);
    files.push({ path: `paper/tables/${h}.tex`, content: texTable(contrasts, `${h}: return difference vs ${baseline}`, `tab:${h}`, tag) });
    files.push({ path: `paper/figures/${h}-forest.svg`, content: svgForest(contrasts, `${h}: return difference vs ${baseline} (pp)`, tag) });
    if (h === 'H1') {
      files.push({ path: 'paper/figures/H1-returns.svg', content: svgReturnSeries(meanNavSeries(mine, rows), 'H1: mean NAV per arm', tag) });
      files.push({ path: 'paper/tables/H4.tex', content: texH4Table(costQuality(rows, 'H1', baseline), `H4: return difference vs ${baseline} per USD`, 'tab:H4', tag) });
    }
  }
  return files;
}

/** Mean downsampled NAV path per arm over subject-fund runs. shortcut: assumes equal-length navs within an arm, as the runner stores. */
function meanNavSeries(experiments: StoredExperiment[], rows: StudyRow[]): { label: string; points: number[] }[] {
  const sums = new Map<string, { sum: number[]; n: number }>();
  for (const e of experiments) {
    const subjects = new Set(rows.filter((r) => r.experimentId === e.id).map((r) => r.fundKey));
    for (const arm of parse<ExperimentResult>(e.resultJson)?.runs ?? []) {
      const acc = sums.get(arm.label) ?? { sum: [], n: 0 };
      for (const run of arm.runs ?? []) {
        for (const f of subjects) {
          const nav = run.navs?.[f];
          if (!nav) continue;
          nav.forEach((v, j) => (acc.sum[j] = (acc.sum[j] ?? 0) + v));
          acc.n++;
        }
      }
      sums.set(arm.label, acc);
    }
  }
  return [...sums].filter(([, a]) => a.n > 0).map(([label, a]) => ({ label, points: a.sum.map((v) => v / a.n) }));
}
