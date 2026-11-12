import { Fragment, useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { DecisionRecord } from '@black-sheep/engine/experiment';
import { EXPERIMENT_REPLAY_MAX_DECISIONS } from '../../config/game';
import { fundName } from './chronicle';
import { feedAt } from './replay';
import { cx, fmtMoney } from './fmt';

const W = 640; const H = 240; const PAD = 10;
const PLAY_STEP_MS = 150;
/** Fund line colours, cycled; CSS vars from index.css. */
const LINE = ['blue', 'green', 'orange', 'purple', 'yellow', 'red'];
const SOURCE: Record<DecisionRecord['source'], { label: string; cls: string }> = {
  llm: { label: 'LLM', cls: 'bg-terminal-violet/20 text-terminal-violet' },
  policy: { label: 'policy', cls: 'bg-white/[0.08] text-terminal-soft' },
  fallback: { label: 'fallback', cls: 'bg-terminal-warn/20 text-terminal-warn' },
};

function action(d: DecisionRecord['decision']): string {
  return [d.action.toUpperCase(), d.ticker, d.dollarAmount ? fmtMoney(d.dollarAmount) : null].filter(Boolean).join(' ');
}

/** One run replayed: every fund's NAV on shared axes, a tick cursor, and the decisions made up to it. */
export default function RunReplay() {
  const run = useGameStore((s) => s.selectedRun);
  const { data, loading, error } = useGameStore((s) => s.replay);
  const selectRun = useGameStore((s) => s.selectRun);
  const details = useGameStore((s) => s.chronicle.details);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);
  const last = Math.max(0, (data?.navTicks?.length ?? 1) - 1);

  // A new replay starts paused at the first point (never autoplays).
  useEffect(() => { setI(0); setPlaying(false); }, [data]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setI((x) => (x >= last ? x : x + 1)), PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [playing, last]);
  useEffect(() => { if (playing && i >= last) setPlaying(false); }, [playing, i, last]);

  const chart = useMemo(() => {
    // Defensive: a payload from an older server may lack navs/events; it must render the empty state, not crash.
    if (!data || !data.navs || !Array.isArray(data.navTicks) || data.navTicks.length === 0) return null;
    const all = Object.values(data.navs).flat();
    const min = Math.min(...all); const max = Math.max(...all);
    const end = data.navTicks[data.navTicks.length - 1] || 1;
    const x = (tick: number) => PAD + (tick / end) * (W - PAD * 2);
    const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);
    const lines = Object.entries(data.navs).map(([k, n], j) => ({
      k,
      color: `rgb(var(--${LINE[j % LINE.length]}))`,
      pts: n.map((v, p) => `${x(data.navTicks[p] ?? end).toFixed(1)},${y(v).toFixed(1)}`).join(' '),
    }));
    return { x, min, max, lines, end };
  }, [data]);

  const feed = useMemo(() => (data && chart ? feedAt(data.decisions ?? [], data.navTicks, i) : []), [data, chart, i]);
  const digest = run && details[run.experimentId]?.result?.runs.find((a) => a.label === run.arm)?.runs.find((r) => r.seed === run.seed)?.digest;

  if (!run) return null;
  const tick = data?.navTicks?.[i] ?? 0;
  const copy = () => {
    void navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <div className="panel space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">REPLAY · experiment {run.experimentId} · {run.arm} · seed {run.seed}</span>
        <div className="flex gap-2 text-[12px]">
          <button type="button" onClick={copy} className="press rounded-full bg-white/[0.06] px-3 py-1 hover:bg-white/[0.1]">{copied ? 'Copied' : 'Copy link'}</button>
          <button type="button" onClick={() => selectRun(null)} className="press rounded-full bg-white/[0.06] px-3 py-1 hover:bg-white/[0.1]">Close</button>
        </div>
      </div>

      {loading ? (
        <div className="p-4 text-center text-[13px] text-terminal-dim">Loading replay…</div>
      ) : error ? (
        <div className="p-4 text-center text-[13px] text-terminal-red">Could not load this run: {error}</div>
      ) : !data || !chart ? (
        <div className="p-4 text-center text-[13px] text-terminal-dim">This run has no NAV series to replay.</div>
      ) : (
        <>
          <div className="relative h-[240px]">
            <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label={`NAV of every fund, cursor at tick ${tick}`}>
              {[0.25, 0.5, 0.75].map((f) => (<line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="rgb(255 255 255 / 0.05)" vectorEffect="non-scaling-stroke" />))}
              {/* Director interventions run the full height, dashed; scripted/random events are short ticks on the floor. */}
              {(data.events ?? []).map((e, n) => e.director ? (
                <line key={n} x1={chart.x(e.tick)} x2={chart.x(e.tick)} y1={PAD} y2={H - PAD} stroke="rgb(var(--purple) / 0.6)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"><title>{`Director: ${e.type} at tick ${e.tick}`}</title></line>
              ) : (
                <line key={n} x1={chart.x(e.tick)} x2={chart.x(e.tick)} y1={H - PAD - 14} y2={H - PAD} stroke="rgb(var(--dim) / 0.7)" vectorEffect="non-scaling-stroke"><title>{`${e.type} at tick ${e.tick}`}</title></line>
              ))}
              {chart.lines.map((l) => (<polyline key={l.k} points={l.pts} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />))}
              <line x1={chart.x(tick)} x2={chart.x(tick)} y1={PAD} y2={H - PAD} stroke="rgb(255 255 255 / 0.5)" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="pointer-events-none absolute left-0 top-0 text-[10px] text-terminal-dim">{fmtMoney(chart.max)}</div>
            <div className="pointer-events-none absolute bottom-0 left-0 text-[10px] text-terminal-dim">{fmtMoney(chart.min)}</div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
            {chart.lines.map((l) => {
              const n = data.navs[l.k];
              return (
                <span key={l.k} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                  {fundName(l.k)} <span className="text-terminal-dim">{fmtMoney(n[Math.min(i, n.length - 1)] ?? 0)}</span>
                </span>
              );
            })}
            <span className="flex items-center gap-1.5 text-terminal-dim"><span className="h-3 border-l border-dashed border-terminal-violet" />Director event</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { if (i >= last) setI(0); setPlaying((p) => !p); }}
              className="press w-16 rounded-full bg-white/[0.06] px-3 py-1 text-[12px] hover:bg-white/[0.1]"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              min={0}
              max={last}
              value={i}
              onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }}
              aria-label="Replay cursor"
              aria-valuetext={`Tick ${tick}`}
              className="flex-1 accent-[rgb(var(--blue))]"
            />
            <span className="w-20 text-right text-[12px] text-terminal-dim">tick {tick}</span>
          </div>

          {data.truncated && (
            <div className="text-[12px] text-terminal-warn">Decisions are capped at the first {EXPERIMENT_REPLAY_MAX_DECISIONS.toLocaleString('en-US')}; later ones are not shown.</div>
          )}

          <div className="max-h-[420px] space-y-1.5 overflow-y-auto" aria-label="Decisions up to the cursor">
            {feed.length === 0 ? (
              <div className="p-4 text-center text-[13px] text-terminal-dim">No decisions yet at this tick.</div>
            ) : feed.map(({ d, fresh }, n) => (
              <div key={n} className={cx('rounded-xl px-4 py-2.5 text-[13px]', fresh ? 'bg-terminal-raised ring-1 ring-terminal-accent/50' : 'bg-white/[0.03]')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{fundName(d.fundKey)}</span>
                  <span className="text-[12px] text-terminal-dim">tick {d.tick}</span>
                  <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-medium', SOURCE[d.source]?.cls)}>{SOURCE[d.source]?.label ?? d.source}</span>
                  <span className="font-medium">{action(d.decision)}</span>
                  {d.outcome && <span className="text-[12px] text-terminal-dim">→ {d.outcome}</span>}
                  {d.costUsd > 0 && <span className="ml-auto text-[12px] text-terminal-dim">${d.costUsd.toFixed(4)}</span>}
                </div>
                {d.decision.reasoning && <div className="mt-1 text-terminal-soft">{d.decision.reasoning}</div>}
                {d.toolCalls.length > 0 && (
                  <div className="mt-1 text-[11px] text-terminal-dim">
                    tools: {d.toolCalls.map((t, m) => <span key={m} className={t.ok ? '' : 'text-terminal-red'}>{m > 0 && ', '}{t.name}{t.ok ? '' : ' (failed)'}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-terminal-border pt-3 font-mono text-[11px] text-terminal-dim">
            <dt>config hash</dt><dd className="break-all">{data.manifest.configHash}</dd>
            <dt>digest</dt><dd className="break-all">{digest ?? '—'}</dd>
            {Object.entries(data.manifest.fundProfileHashes).map(([k, h]) => (
              <Fragment key={k}><dt>{k}</dt><dd className="break-all">{h}</dd></Fragment>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
