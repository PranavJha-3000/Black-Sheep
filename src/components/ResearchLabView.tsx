import { useEffect, useState } from 'react';
import { FUND_PROFILES } from '@black-sheep/engine/funds';
import type { ExperimentVariable } from '@black-sheep/engine/experiment';
import type { MemoryMode } from '@black-sheep/engine/simMemory';
import { useGameStore } from '../store/gameStore';
import type { ExperimentDetail } from '../../server/labCore';
import { EXPERIMENT_MAX_BUDGET_USD, EXPERIMENT_MAX_SEEDS, EXPERIMENT_MAX_TICKS } from '../../config/game';
import { MODEL_REGISTRY } from '../../config/models';
import { cx, fmtNum, sparkPath } from './fmt';

const pct = (n: number | null, dp = 1) => (n === null ? '—' : `${(n * 100).toFixed(dp)}%`);
const signed = (n: number, dp: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(dp)}`;
/** `+1.2% [−0.4, +2.8]`; a missing mean or interval renders as an em dash. */
const fmtCI = (mean: number | null, ci: [number, number] | null) =>
  mean === null ? '—' : `${signed(mean, 1)}%${ci ? ` [${signed(ci[0], 1)}, ${signed(ci[1], 1)}]` : ''}`;
const fmtP = (p: number | null | undefined) => (p == null ? '—' : p.toPrecision(3));
const usd = (n: number) => `$${n.toFixed(2)}`;
const MEMORY_MODES: MemoryMode[] = ['none', 'episodic', 'reflective', 'full'];
/** Behaviour columns; the tooltips carry the definitions from D-044. */
const BEHAVIOUR_COLUMNS = [
  { key: 'actionEntropy', label: 'Entropy', tip: 'Shannon entropy of the counts of buy, short, close and hold over all decisions, divided by log2(4). 0 = one action only, 1 = uniform.' },
  { key: 'riskCompliance', label: 'Risk compliance', tip: 'Share of non-hold proposals the risk limit left unchanged. Refused proposals (turned into hold) count as non-compliant.' },
  { key: 'repeatedErrorRate', label: 'Repeated errors', tip: 'Of the closes at a loss on a ticker, the share followed by a new open on that ticker in the same direction within 50 ticks.' },
  { key: 'shockDeRisk', label: 'Shock de-risk', tip: 'Mean drop in gross exposure (percentage points of NAV) 30 ticks after each shock (price impact of 5% or more). Positive = cut exposure.' },
  { key: 'tradeRate', label: 'Trade rate', tip: 'Trades divided by decisions.' },
] as const;
/** `mean [lo, hi]`; missing or null stats (old experiments) render as an em dash. */
const fmtStat = (s: { mean: number | null; ci: [number, number] | null } | null | undefined) =>
  !s || s.mean === null ? '—' : `${fmtNum(s.mean, 2)}${s.ci ? ` [${fmtNum(s.ci[0], 2)}, ${fmtNum(s.ci[1], 2)}]` : ''}`;
const BRAIN_OPTIONS: { value: string; label: string }[] = [
  { value: 'policy', label: 'Policy' },
  ...Object.entries(MODEL_REGISTRY).map(([id, m]) => ({ value: id, label: m.displayName })),
];
const fmtBrains = (m: Record<string, string>) =>
  Object.keys(m).length ? Object.entries(m).map(([k, b]) => `${FUND_NAME[k] ?? k}: ${brainLabel(b)}`).join(' · ') : 'Deterministic policies';
const brainLabel = (b: string) => BRAIN_OPTIONS.find((o) => o.value === b)?.label ?? b;
const FUND_NAME: Record<string, string> = Object.fromEntries(FUND_PROFILES.map((p) => [p.key, p.name]));
const STATUS_STYLE: Record<string, string> = {
  queued: 'text-terminal-dim',
  running: 'text-terminal-caution',
  done: 'text-terminal-green',
  failed: 'text-terminal-red',
};
const SERIES_COLORS = ['rgb(var(--blue))', 'rgb(var(--yellow))', 'rgb(var(--green))', 'rgb(var(--purple))', 'rgb(var(--orange))'];

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="mb-4 flex items-center justify-between">
        <span className="label">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** RESEARCH LAB (VISION §10, §13 view 6): controlled, policy-only experiment worlds. */
export default function ResearchLabView() {
  const list = useGameStore((s) => s.lab.list);
  const detail = useGameStore((s) => s.lab.detail);
  const selectedId = useGameStore((s) => s.selectedExperimentId);
  const openExperiment = useGameStore((s) => s.openExperiment);
  const [creating, setCreating] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Section
        title="EXPERIMENTS"
        right={
          <button type="button" onClick={() => setCreating((c) => !c)} className="press rounded-full bg-terminal-accent/15 px-3 py-1 text-[12px] font-medium normal-case tracking-normal text-terminal-accent hover:bg-terminal-accent/25">
            {creating ? 'Close' : 'New experiment'}
          </button>
        }
      >
        {!list ? (
          <div className="p-4 text-center text-[13px] text-terminal-dim">Loading experiments…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-center text-[13px] text-terminal-dim">No experiments yet.</div>
        ) : (
          <div className="-mx-2 space-y-0.5">
            {list.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  openExperiment(e.id);
                }}
                className={cx('press block w-full rounded-lg px-3 py-2.5 text-left text-[13px]', e.id === selectedId ? 'bg-terminal-raised' : 'hover:bg-white/[0.04]')}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-semibold">{e.name}</span>
                  <span className={cx('text-[12px] capitalize', STATUS_STYLE[e.status])}>{e.status}</span>
                </div>
                <div className="text-terminal-dim">
                  #{e.id} · {e.variable} · {e.arms} arms × {e.seeds} seeds
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <div className="min-w-0 space-y-6">
        {creating ? (
          <CreateExperiment onDone={() => setCreating(false)} />
        ) : selectedId === null ? (
          <Section title="Research Lab">
            <p className="max-w-[72ch] text-[14px] leading-relaxed text-terminal-soft">
              Controlled experiment worlds (VISION Mode B): each experiment varies one variable across arms and runs every arm on the same
              seeds, independent of the live world. Funds trade on their deterministic policies unless given a model brain, which needs a server key and a budget. Pick an
              experiment, or create one with New experiment and the lab admin token.
            </p>
          </Section>
        ) : !detail ? (
          <Section title="EXPERIMENT">
            <div className="p-6 text-center text-[13px] text-terminal-dim">Loading experiment…</div>
          </Section>
        ) : (
          <ExperimentResultView d={detail} />
        )}
      </div>
    </div>
  );
}

function ExperimentResultView({ d }: { d: ExperimentDetail }) {
  const r = d.result;
  // One y-domain over every arm so the NAV charts are comparable by eye.
  const allNavs = r?.series.flatMap((a) => a.funds.flatMap((f) => f.navs)) ?? [];
  const domain: [number, number] | undefined = allNavs.length ? [Math.min(...allNavs), Math.max(...allNavs)] : undefined;
  return (
    <>
      <Section title={`Experiment #${d.id}`} right={<span className={cx('text-[12px] font-medium capitalize', STATUS_STYLE[d.status])}>{d.status}</span>}>
        <div className="mb-4 text-[20px] font-semibold tracking-[-0.015em]">{d.name}</div>
        <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-[13px]">
          <dt className="text-terminal-dim">Variable</dt>
          <dd>{d.variable}</dd>
          <dt className="text-terminal-dim">Base</dt>
          <dd>
            {d.spec
              ? `${d.spec.base.funds.map((k) => FUND_NAME[k] ?? k).join(', ')} · director ${d.spec.base.directorMode} · cadence ${d.spec.base.decisionEveryTicks ?? 'registry'} · ${d.spec.base.ticks} ticks`
              : '—'}
          </dd>
          <dt className="text-terminal-dim">Seeds</dt>
          <dd>{d.spec?.seeds.join(', ') ?? '—'}</dd>
          <dt className="text-terminal-dim">Config hash</dt>
          <dd className="font-mono">{d.manifest?.configHash ?? '—'}</dd>
          <dt className="text-terminal-dim">World constants</dt>
          <dd className="font-mono">{d.manifest?.worldConstantsHash ?? '—'}</dd>
          <dt className="text-terminal-dim">Fund profiles</dt>
          <dd className="font-mono">
            {d.manifest ? Object.entries(d.manifest.fundProfileHashes).map(([k, h]) => `${k} ${h}`).join(' · ') : '—'}
          </dd>
          <dt className="text-terminal-dim">Brains</dt>
          <dd>
            {d.spec?.variable === 'brains'
              ? // Each arm value replaces the base map, so list what each arm actually ran.
                d.spec.values.map((v) => fmtBrains(v as Record<string, string>)).join(' | ')
              : fmtBrains(d.spec?.base.brains ?? {})}
          </dd>
          {r && (
            <>
              <dt className="text-terminal-dim">Model spend</dt>
              <dd>
                {usd(r.costUsd)} of {usd(r.estimateUsd)} worst-case estimate
                {d.spec?.budgetUsd != null && ` · budget ${usd(d.spec.budgetUsd)}`}
              </dd>
            </>
          )}
        </dl>
        {d.error && <div className="mt-2 text-[11px] text-terminal-red">Failed: {d.error}</div>}
      </Section>

      {!r ? (
        <Section title="RESULTS">
          <div className="p-6 text-center text-[13px] text-terminal-dim">
            {d.status === 'failed' ? 'No results.' : 'Waiting for the runner…'}
          </div>
        </Section>
      ) : (
        <>
          <Section title="RESULTS BY ARM">
            <div className="overflow-x-auto">
              <table className="data-table w-full text-[13px]">
                <thead>
                  <tr>
                    {['Arm', 'Fund', 'n', 'Return mean [95% CI]', 'Max DD', 'Sharpe', 'Δ vs baseline [95% CI]', 'Wins', 'p (Holm)', 'Survival', 'Fallback rate', 'Cost / run'].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.arms.flatMap((arm) =>
                    arm.funds.map((f, fi) => (
                      <tr key={`${arm.label}-${f.key}`} className={cx(fi === 0 && 'border-t border-terminal-border')}>
                        <td className="text-terminal-dim">{fi === 0 ? arm.label : ''}</td>
                        <td className="font-semibold">{f.name}</td>
                        <td>{f.n}</td>
                        <td className={cx(f.totalReturn.mean !== null && (f.totalReturn.mean >= 0 ? 'text-terminal-green' : 'text-terminal-red'))}>
                          {fmtCI(f.totalReturn.mean, f.totalReturnCI)}
                        </td>
                        <td>{pct(f.maxDrawdown.mean)}</td>
                        <td>{f.sharpe.mean === null ? '—' : fmtNum(f.sharpe.mean, 3)}</td>
                        <td>
                          {f.vsBaseline ? fmtCI(f.vsBaseline.meanDiff, f.vsBaseline.ci) : <span className="text-terminal-dim">baseline</span>}
                          {f.baselineLabel && <span className="block text-[10px] text-terminal-dim">vs {f.baselineLabel}</span>}
                        </td>
                        <td>{f.vsBaseline ? `${f.vsBaseline.wins}/${f.vsBaseline.pairs}` : '—'}</td>
                        <td>{fmtP(f.vsBaseline?.pHolm)}</td>
                        <td className={cx(f.survival < 1 && 'text-terminal-red')}>{pct(f.survival, 0)}</td>
                        <td>{fi === 0 ? pct(arm.fallbackRate, 0) : ''}</td>
                        <td>{fi === 0 ? usd(arm.meanCostUsd) : ''}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-2 grid gap-1 text-[11px] text-terminal-dim">
              {r.arms.map((a) => (
                <div key={a.label}>
                  {a.label}: {fmtNum(a.meanEvents, 1)} events and {fmtNum(a.meanDirectorInterventions, 1)} Director interventions per run
                </div>
              ))}
            </div>
          </Section>

          <Section title="BEHAVIOUR">
            <div className="overflow-x-auto">
              <table className="data-table w-full text-[13px]">
                <thead>
                  <tr>
                    <th>Arm</th>
                    <th>Fund</th>
                    {BEHAVIOUR_COLUMNS.map((c) => (
                      <th key={c.key} title={c.tip}>{c.label} mean [95% CI]</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.arms.flatMap((arm) =>
                    arm.funds.map((f, fi) => (
                      <tr key={`${arm.label}-${f.key}`} className={cx(fi === 0 && 'border-t border-terminal-border')}>
                        <td className="text-terminal-dim">{fi === 0 ? arm.label : ''}</td>
                        <td className="font-semibold">{f.name}</td>
                        {BEHAVIOUR_COLUMNS.map((c) => (
                          <td key={c.key}>{fmtStat(f.behaviour?.[c.key])}</td>
                        ))}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="NAV — FIRST SEED">
            <div className="grid gap-6 md:grid-cols-2">
              {r.series.map((arm) => (
                <div key={arm.label}>
                  <div className="mb-2 text-[12px] font-medium text-terminal-soft">{arm.label}</div>
                  <svg viewBox="0 0 300 80" className="h-24 w-full rounded-xl bg-black/30" role="img" aria-label={`NAV of each fund in ${arm.label}`}>
                    {arm.funds.map((f, i) => (
                      <path key={f.key} d={sparkPath(f.navs, 300, 80, 2, domain)} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    ))}
                  </svg>
                  <div className="mt-2 flex flex-wrap gap-x-4 text-[11px]">
                    {arm.funds.map((f, i) => (
                      <span key={f.key} style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>{FUND_NAME[f.key] ?? f.key}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-terminal-dim">All charts share one y-axis{domain ? `: ${fmtNum(domain[0], 0)} – ${fmtNum(domain[1], 0)}` : ''}.</div>
          </Section>

          <Section title="Runs (reproducibility)">
            <div className="space-y-1 text-[11px]">
              {r.runs.map((a) => (
                <div key={a.label}>
                  <span className="text-terminal-dim">{a.label}: </span>
                  {a.runs.map((x) => (
                    <span key={x.seed} className="mr-3 font-mono">
                      seed {x.seed} → {x.digest}
                      {x.liquidated.length > 0 && <span className="text-terminal-red"> ({x.liquidated.length} liquidated)</span>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </Section>

          <Section title="Limitations">
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-terminal-dim">
              <li>n = number of seeds. Intervals are bootstrap 95% CIs of the mean over seeds; Δ is paired by seed against the fund's baseline — the first arm that contains it. p is a sign test on those paired differences, Holm-corrected across the comparisons in this experiment.</li>
              <li>Funds without a model brain use their deterministic policies. Fallback rate is the share of model decisions that fell back to the policy; cost is mean model spend per run.</li>
              <li>Sharpe and drawdown are per NAV snapshot (every 3 ticks) and not annualised.</li>
              <li>A run is reproducible from its seed and configuration: rerunning it must give the same digest.</li>
            </ul>
          </Section>
        </>
      )}
    </>
  );
}

const VARIABLES: { value: ExperimentVariable; label: string }[] = [
  { value: 'directorMode', label: 'World Director (none vs rule)' },
  { value: 'funds', label: 'Fund roster (each fund alone vs all)' },
  { value: 'decisionEveryTicks', label: 'Decision cadence (ticks)' },
  { value: 'brains', label: 'Brain (one fund: policy vs models)' },
  { value: 'memory', label: 'Memory (none / episodic / reflective / full)' },
];

function CreateExperiment({ onDone }: { onDone: () => void }) {
  const createExperiment = useGameStore((s) => s.createExperiment);
  const estimateExperiment = useGameStore((s) => s.estimateExperiment);
  const [name, setName] = useState('');
  const [variable, setVariable] = useState<ExperimentVariable>('directorMode');
  const [funds, setFunds] = useState<string[]>(FUND_PROFILES.map((p) => p.key));
  const [directorMode, setDirectorMode] = useState<'none' | 'rule'>('rule');
  const [cadenceValues, setCadenceValues] = useState('registry, 5, 30');
  const [ticks, setTicks] = useState(2000);
  const [seedCount, setSeedCount] = useState(5);
  const [firstSeed, setFirstSeed] = useState(1);
  const [token, setToken] = useState('');
  const [baseBrains, setBaseBrains] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState(5);
  const [memory, setMemory] = useState<MemoryMode>('none');
  // For variable = memory: which modes become arms (one arm each).
  const [armMemory, setArmMemory] = useState<MemoryMode[]>(['none', 'full']);
  // For variable = brains: the fund under test and which brains become arms (one arm per brain).
  const [subject, setSubject] = useState(FUND_PROFILES[0]!.key);
  const [armBrains, setArmBrains] = useState<string[]>(['policy', 'claude-haiku-5-5']);
  const [estimate, setEstimate] = useState<{ ok: true; estimateUsd: number } | { ok: false; error: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const values = (): unknown[] => {
    if (variable === 'directorMode') return ['none', 'rule'];
    // Each fund alone, then the whole roster: a "mixed world" against single-fund worlds.
    if (variable === 'funds') return [...funds.map((k) => [k]), funds];
    if (variable === 'brains') return armBrains.map((b) => ({ [subject]: b }));
    if (variable === 'memory') return armMemory;
    return cadenceValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (v === 'registry' ? null : Number(v)));
  };

  // Arm brain values replace the base map, so under the brains variable only they count.
  const baseModels = variable === 'brains' ? {} : Object.fromEntries(Object.entries(baseBrains).filter(([k]) => funds.includes(k)));
  const usesModel = variable === 'brains' ? armBrains.some((b) => b !== 'policy') : Object.values(baseModels).some((b) => b !== 'policy');
  const buildBody = () => ({
    name,
    variable,
    values: values(),
    base: { funds, directorMode, decisionEveryTicks: null, ticks, brains: baseModels, memory },
    seeds: Array.from({ length: seedCount }, (_, i) => firstSeed + i),
    ...(usesModel ? { budgetUsd: budget } : {}),
  });

  // Live worst-case estimate from the server's dry run (never duplicated client-side); needs the token.
  const bodyKey = JSON.stringify(buildBody());
  useEffect(() => {
    setEstimate(null);
    if (!usesModel || token.length === 0) return;
    let stale = false;
    const t = setTimeout(() => void estimateExperiment(JSON.parse(bodyKey), token).then((r) => !stale && setEstimate(r)), 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [bodyKey, token, usesModel, estimateExperiment]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = buildBody();
    const r = await createExperiment(body, token);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  };

  const input = 'w-full rounded-lg border border-terminal-border bg-black/30 px-3 py-2 text-[13px] text-terminal-text transition-colors focus:border-terminal-accent/60 focus:outline-none';
  return (
    <Section title="NEW EXPERIMENT">
      <div className="grid gap-5 text-[12px] md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-terminal-dim">Name</span>
          <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Director on vs off" />
        </label>
        <label className="space-y-1">
          <span className="text-terminal-dim">Variable (one per experiment)</span>
          <select className={input} value={variable} onChange={(e) => setVariable(e.target.value as ExperimentVariable)}>
            {VARIABLES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend className="text-terminal-dim">Funds (base)</legend>
          {FUND_PROFILES.map((p) => (
            <label key={p.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={funds.includes(p.key)}
                onChange={(e) => setFunds((fs) => (e.target.checked ? FUND_PROFILES.map((x) => x.key).filter((k) => k === p.key || fs.includes(k)) : fs.filter((k) => k !== p.key)))}
              />
              {p.name}
            </label>
          ))}
        </fieldset>
        <div className="space-y-2">
          {variable !== 'directorMode' && (
            <label className="block space-y-1">
              <span className="text-terminal-dim">Director (base)</span>
              <select className={input} value={directorMode} onChange={(e) => setDirectorMode(e.target.value as 'none' | 'rule')}>
                <option value="rule">rule</option>
                <option value="none">none</option>
              </select>
            </label>
          )}
          {variable === 'brains' && (
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="text-terminal-dim">Fund under test</span>
                <select className={input} value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {FUND_PROFILES.map((p) => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              </label>
              <fieldset className="space-y-1">
                <legend className="text-terminal-dim">Brains (one arm each)</legend>
                {BRAIN_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2">
                    <input type="checkbox" checked={armBrains.includes(o.value)} onChange={(e) => setArmBrains((bs) => (e.target.checked ? [...bs, o.value] : bs.filter((b) => b !== o.value)))} />
                    {o.label}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          {variable !== 'memory' && (
            <label className="block space-y-1">
              <span className="text-terminal-dim">Memory (base)</span>
              <select className={input} value={memory} onChange={(e) => setMemory(e.target.value as MemoryMode)}>
                {MEMORY_MODES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          )}
          {variable === 'memory' && (
            <fieldset className="space-y-1">
              <legend className="text-terminal-dim">Memory modes (one arm each)</legend>
              {MEMORY_MODES.map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="checkbox" checked={armMemory.includes(m)} onChange={(e) => setArmMemory((ms) => MEMORY_MODES.filter((x) => (x === m ? e.target.checked : ms.includes(x))))} />
                  {m}
                </label>
              ))}
            </fieldset>
          )}
          {!usesModel && (memory !== 'none' || variable === 'memory') && <div className="text-terminal-dim">Memory only affects model brains.</div>}
          {variable === 'decisionEveryTicks' && (
            <label className="block space-y-1">
              <span className="text-terminal-dim">Cadence values (comma-separated; "registry" = each fund's own)</span>
              <input className={input} value={cadenceValues} onChange={(e) => setCadenceValues(e.target.value)} />
            </label>
          )}
          <div className="text-terminal-dim">
            Arms:{' '}
            {values()
              .map((v) =>
                Array.isArray(v)
                  ? v.map((k) => FUND_NAME[k] ?? k).join(' + ')
                  : v && typeof v === 'object'
                    ? Object.values(v).map((b) => brainLabel(String(b))).join('')
                    : String(v ?? 'registry'),
              )
              .join(' | ')}
          </div>
        </div>
        {variable !== 'brains' && (
        <fieldset className="space-y-1">
          <legend className="text-terminal-dim">Brain per fund (base)</legend>
          {FUND_PROFILES.filter((p) => funds.includes(p.key)).map((p) => (
            <label key={p.key} className="flex items-center justify-between gap-2">
              {p.name}
              <select className={`${input} !w-auto`} aria-label={`Brain for ${p.name}`} value={baseBrains[p.key] ?? 'policy'} onChange={(e) => setBaseBrains((b) => ({ ...b, [p.key]: e.target.value }))}>
                {BRAIN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        )}
        {usesModel && (
          <div className="space-y-1">
            <label className="block space-y-1">
              <span className="text-terminal-dim">Budget (USD, max {EXPERIMENT_MAX_BUDGET_USD})</span>
              <input className={input} type="number" min={0.01} max={EXPERIMENT_MAX_BUDGET_USD} step={0.5} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
            </label>
            <div className={estimate && !estimate.ok ? 'text-terminal-red' : 'text-terminal-dim'} role="status">
              {token.length === 0
                ? 'Enter the admin token to see the worst-case estimate.'
                : !estimate
                  ? 'Estimating…'
                  : estimate.ok
                    ? `Worst-case model spend: ${usd(estimate.estimateUsd)}${estimate.estimateUsd > budget ? ` (above budget; the run stops at ${usd(budget)})` : ''}`
                    : estimate.error}
            </div>
          </div>
        )}
        <label className="space-y-1">
          <span className="text-terminal-dim">Ticks per run (max {EXPERIMENT_MAX_TICKS})</span>
          <input className={input} type="number" min={10} max={EXPERIMENT_MAX_TICKS} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-terminal-dim">Seeds (max {EXPERIMENT_MAX_SEEDS})</span>
            <input className={input} type="number" min={1} max={EXPERIMENT_MAX_SEEDS} value={seedCount} onChange={(e) => setSeedCount(Number(e.target.value))} />
          </label>
          <label className="space-y-1">
            <span className="text-terminal-dim">First seed</span>
            <input className={input} type="number" min={0} value={firstSeed} onChange={(e) => setFirstSeed(Number(e.target.value))} />
          </label>
        </div>
        <label className="space-y-1 md:col-span-2">
          <span className="text-terminal-dim">Lab admin token (sent with this request only, never stored)</span>
          <input className={input} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
      </div>
      {error && <div className="mt-2 text-[11px] text-terminal-red" role="alert">{error}</div>}
      <button
        type="button"
        disabled={busy || token.length === 0}
        onClick={() => void submit()}
        className="press mt-5 rounded-full bg-terminal-accent px-5 py-2 text-[13px] font-medium text-white hover:bg-terminal-accent/85 disabled:cursor-default disabled:bg-terminal-raised disabled:text-terminal-faint"
      >
        {busy ? 'Queuing…' : 'Queue experiment'}
      </button>
    </Section>
  );
}
