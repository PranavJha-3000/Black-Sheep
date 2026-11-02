import { useState } from 'react';
import { FUND_PROFILES } from '@black-sheep/engine/funds';
import type { ExperimentVariable } from '@black-sheep/engine/experiment';
import { useGameStore } from '../store/gameStore';
import type { ExperimentDetail } from '../../server/labCore';
import { EXPERIMENT_MAX_SEEDS, EXPERIMENT_MAX_TICKS } from '../../config/game';
import { cx, fmtNum, sparkPath } from './fmt';

const pct = (n: number | null, dp = 1) => (n === null ? '—' : `${(n * 100).toFixed(dp)}%`);
const signedPct = (n: number, dp = 2) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(dp)}%`;
const FUND_NAME: Record<string, string> = Object.fromEntries(FUND_PROFILES.map((p) => [p.key, p.name]));
const STATUS_STYLE: Record<string, string> = {
  queued: 'text-terminal-dim',
  running: 'text-[#e0c060]',
  done: 'text-terminal-green',
  failed: 'text-terminal-red',
};
const SERIES_COLORS = ['#8fb3ff', '#e0c060', '#7fd17f', '#d08fff', '#ff8f8f'];

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] tracking-widest text-terminal-dim">
        <span>{title}</span>
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
    <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
      <Section
        title="EXPERIMENTS"
        right={
          <button type="button" onClick={() => setCreating((c) => !c)} className="text-[10px] tracking-wider text-[#8fb3ff] hover:text-white">
            {creating ? 'CLOSE' : '+ NEW'}
          </button>
        }
      >
        {!list ? (
          <div className="p-4 text-center text-[12px] text-terminal-dim">Loading experiments…</div>
        ) : list.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-terminal-dim">No experiments yet.</div>
        ) : (
          <div className="space-y-0.5">
            {list.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setCreating(false);
                  openExperiment(e.id);
                }}
                className={cx('block w-full rounded px-2 py-1.5 text-left text-[11px]', e.id === selectedId ? 'bg-[#161616] text-white' : 'hover:bg-[#121212]')}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-bold">{e.name}</span>
                  <span className={cx('uppercase', STATUS_STYLE[e.status])}>{e.status}</span>
                </div>
                <div className="text-terminal-dim">
                  #{e.id} · {e.variable} · {e.arms} arms × {e.seeds} seeds
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <div className="min-w-0 space-y-3">
        {creating ? (
          <CreateExperiment onDone={() => setCreating(false)} />
        ) : selectedId === null ? (
          <Section title="RESEARCH LAB">
            <p className="text-[12px] leading-relaxed text-terminal-dim">
              Controlled experiment worlds (VISION Mode B): each experiment varies one variable across arms and runs every arm on the same
              seeds, independent of the live world. Funds trade on their deterministic policies — no model calls, no spend. Pick an
              experiment, or create one with the lab admin token.
            </p>
          </Section>
        ) : !detail ? (
          <Section title="EXPERIMENT">
            <div className="p-6 text-center text-[12px] text-terminal-dim">Loading experiment…</div>
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
  return (
    <>
      <Section title={`EXPERIMENT #${d.id}`} right={<span className={cx('uppercase', STATUS_STYLE[d.status])}>{d.status}</span>}>
        <div className="mb-2 text-[13px] font-bold">{d.name}</div>
        <dl className="grid grid-cols-[150px_1fr] gap-y-1 text-[11px]">
          <dt className="text-terminal-dim">VARIABLE</dt>
          <dd>{d.variable}</dd>
          <dt className="text-terminal-dim">BASE</dt>
          <dd>
            {d.spec
              ? `${d.spec.base.funds.map((k) => FUND_NAME[k] ?? k).join(', ')} · director ${d.spec.base.directorMode} · cadence ${d.spec.base.decisionEveryTicks ?? 'registry'} · ${d.spec.base.ticks} ticks`
              : '—'}
          </dd>
          <dt className="text-terminal-dim">SEEDS</dt>
          <dd>{d.spec?.seeds.join(', ') ?? '—'}</dd>
          <dt className="text-terminal-dim">CONFIG HASH</dt>
          <dd className="font-mono">{d.manifest?.configHash ?? '—'}</dd>
          <dt className="text-terminal-dim">WORLD CONSTANTS</dt>
          <dd className="font-mono">{d.manifest?.worldConstantsHash ?? '—'}</dd>
          <dt className="text-terminal-dim">FUND PROFILES</dt>
          <dd className="font-mono">
            {d.manifest ? Object.entries(d.manifest.fundProfileHashes).map(([k, h]) => `${k} ${h}`).join(' · ') : '—'}
          </dd>
          <dt className="text-terminal-dim">BRAINS</dt>
          <dd>Deterministic policies only (no model calls)</dd>
        </dl>
        {d.error && <div className="mt-2 text-[11px] text-terminal-red">Failed: {d.error}</div>}
      </Section>

      {!r ? (
        <Section title="RESULTS">
          <div className="p-6 text-center text-[12px] text-terminal-dim">
            {d.status === 'failed' ? 'No results.' : 'Waiting for the runner…'}
          </div>
        </Section>
      ) : (
        <>
          <Section title="RESULTS BY ARM">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    {['ARM', 'FUND', 'N', 'RETURN (MEAN ± SD)', 'MAX DD', 'SHARPE', 'SURVIVAL', 'Δ VS BASELINE', 'WINS'].map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-normal text-terminal-dim">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.arms.flatMap((arm) =>
                    arm.funds.map((f, fi) => (
                      <tr key={`${arm.label}-${f.key}`} className={cx(fi === 0 && 'border-t border-terminal-border')}>
                        <td className="px-2 py-1 text-terminal-dim">{fi === 0 ? arm.label : ''}</td>
                        <td className="px-2 py-1 font-bold">{f.name}</td>
                        <td className="px-2 py-1 tabular-nums">{f.n}</td>
                        <td className={cx('px-2 py-1 tabular-nums', f.totalReturn.mean !== null && (f.totalReturn.mean >= 0 ? 'text-terminal-green' : 'text-terminal-red'))}>
                          {pct(f.totalReturn.mean, 2)}
                          {f.totalReturn.std !== null && <span className="text-terminal-dim"> ± {pct(f.totalReturn.std, 2)}</span>}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{pct(f.maxDrawdown.mean)}</td>
                        <td className="px-2 py-1 tabular-nums">{f.sharpe.mean === null ? '—' : fmtNum(f.sharpe.mean, 3)}</td>
                        <td className={cx('px-2 py-1 tabular-nums', f.survival < 1 && 'text-terminal-red')}>{pct(f.survival, 0)}</td>
                        <td className="px-2 py-1 tabular-nums">
                          {f.vsBaseline ? signedPct(f.vsBaseline.meanDiff) : <span className="text-terminal-dim">baseline</span>}
                          {f.baselineLabel && <span className="block text-[10px] text-terminal-dim">vs {f.baselineLabel}</span>}
                        </td>
                        <td className="px-2 py-1 tabular-nums">{f.vsBaseline ? `${f.vsBaseline.wins}/${f.vsBaseline.pairs}` : '—'}</td>
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

          <Section title="NAV — FIRST SEED">
            <div className="grid gap-3 md:grid-cols-2">
              {r.series.map((arm) => (
                <div key={arm.label}>
                  <div className="mb-1 text-[11px] text-terminal-dim">{arm.label}</div>
                  <svg viewBox="0 0 300 80" className="h-20 w-full rounded bg-[#0b0b0b]" role="img" aria-label={`NAV of each fund in ${arm.label}`}>
                    {arm.funds.map((f, i) => (
                      <path key={f.key} d={sparkPath(f.navs, 300, 80)} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth="1.2" />
                    ))}
                  </svg>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[10px]">
                    {arm.funds.map((f, i) => (
                      <span key={f.key} style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>{FUND_NAME[f.key] ?? f.key}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-terminal-dim">Each line is scaled to its own range.</div>
          </Section>

          <Section title="RUNS (REPRODUCIBILITY)">
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

          <Section title="LIMITATIONS">
            <ul className="list-disc space-y-1 pl-5 text-[11px] text-terminal-dim">
              <li>n = number of seeds. Mean ± sample standard deviation; Δ is paired by seed against the fund's baseline — the first arm that contains it. This is not a significance test.</li>
              <li>Policy-only worlds: funds use their deterministic policies, so these results compare rules and world settings, not language models.</li>
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
];

function CreateExperiment({ onDone }: { onDone: () => void }) {
  const createExperiment = useGameStore((s) => s.createExperiment);
  const [name, setName] = useState('');
  const [variable, setVariable] = useState<ExperimentVariable>('directorMode');
  const [funds, setFunds] = useState<string[]>(FUND_PROFILES.map((p) => p.key));
  const [directorMode, setDirectorMode] = useState<'none' | 'rule'>('rule');
  const [cadenceValues, setCadenceValues] = useState('registry, 5, 30');
  const [ticks, setTicks] = useState(2000);
  const [seedCount, setSeedCount] = useState(5);
  const [firstSeed, setFirstSeed] = useState(1);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const values = (): unknown[] => {
    if (variable === 'directorMode') return ['none', 'rule'];
    // Each fund alone, then the whole roster: a "mixed world" against single-fund worlds.
    if (variable === 'funds') return [...funds.map((k) => [k]), funds];
    return cadenceValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (v === 'registry' ? null : Number(v)));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      name,
      variable,
      values: values(),
      base: { funds, directorMode, decisionEveryTicks: null, ticks },
      seeds: Array.from({ length: seedCount }, (_, i) => firstSeed + i),
    };
    const r = await createExperiment(body, token);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  };

  const input = 'w-full rounded border border-terminal-border bg-[#0b0b0b] px-2 py-1 text-[12px] text-white';
  return (
    <Section title="NEW EXPERIMENT">
      <div className="grid gap-3 text-[11px] md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-terminal-dim">NAME</span>
          <input className={input} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Director on vs off" />
        </label>
        <label className="space-y-1">
          <span className="text-terminal-dim">VARIABLE (ONE PER EXPERIMENT)</span>
          <select className={input} value={variable} onChange={(e) => setVariable(e.target.value as ExperimentVariable)}>
            {VARIABLES.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </select>
        </label>
        <fieldset className="space-y-1">
          <legend className="text-terminal-dim">FUNDS (BASE)</legend>
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
              <span className="text-terminal-dim">DIRECTOR (BASE)</span>
              <select className={input} value={directorMode} onChange={(e) => setDirectorMode(e.target.value as 'none' | 'rule')}>
                <option value="rule">rule</option>
                <option value="none">none</option>
              </select>
            </label>
          )}
          {variable === 'decisionEveryTicks' && (
            <label className="block space-y-1">
              <span className="text-terminal-dim">CADENCE VALUES (COMMA-SEPARATED; "registry" = each fund's own)</span>
              <input className={input} value={cadenceValues} onChange={(e) => setCadenceValues(e.target.value)} />
            </label>
          )}
          <div className="text-terminal-dim">
            Arms: {values().map((v) => (Array.isArray(v) ? v.map((k) => FUND_NAME[k] ?? k).join(' + ') : String(v ?? 'registry'))).join(' | ')}
          </div>
        </div>
        <label className="space-y-1">
          <span className="text-terminal-dim">TICKS PER RUN (MAX {EXPERIMENT_MAX_TICKS})</span>
          <input className={input} type="number" min={10} max={EXPERIMENT_MAX_TICKS} value={ticks} onChange={(e) => setTicks(Number(e.target.value))} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-terminal-dim">SEEDS (MAX {EXPERIMENT_MAX_SEEDS})</span>
            <input className={input} type="number" min={1} max={EXPERIMENT_MAX_SEEDS} value={seedCount} onChange={(e) => setSeedCount(Number(e.target.value))} />
          </label>
          <label className="space-y-1">
            <span className="text-terminal-dim">FIRST SEED</span>
            <input className={input} type="number" min={0} value={firstSeed} onChange={(e) => setFirstSeed(Number(e.target.value))} />
          </label>
        </div>
        <label className="space-y-1 md:col-span-2">
          <span className="text-terminal-dim">LAB ADMIN TOKEN (SENT WITH THIS REQUEST ONLY, NEVER STORED)</span>
          <input className={input} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </label>
      </div>
      {error && <div className="mt-2 text-[11px] text-terminal-red" role="alert">{error}</div>}
      <button
        type="button"
        disabled={busy || token.length === 0}
        onClick={() => void submit()}
        className="mt-3 rounded border border-terminal-border px-3 py-1.5 text-[11px] tracking-wider text-white hover:bg-[#161616] disabled:cursor-default disabled:text-[#3a3a3a]"
      >
        {busy ? 'QUEUING…' : 'QUEUE EXPERIMENT'}
      </button>
    </Section>
  );
}
