import { useMemo } from 'react';
import { CHRONICLE_MAX_EXPERIMENTS, useGameStore } from '../store/gameStore';
import type { LeaderboardRow } from '../../server/leaderboardCore';
import { cardsOf } from './chronicle';
import RunReplay from './RunReplay';
import { cx } from './fmt';

const signed = (n: number, dp = 1) => `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(dp)}%`;

/** Leaderboard CI bars share one horizontal axis that always includes 0. */
function Leaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const [lo, hi] = useMemo(() => {
    const xs = rows.flatMap((r) => (r.returnCI ? r.returnCI : r.meanReturn !== null ? [r.meanReturn] : []));
    return [Math.min(0, ...xs), Math.max(0, ...xs)];
  }, [rows]);
  const pos = (v: number) => `${(((v - lo) / (hi - lo || 1)) * 100).toFixed(2)}%`;
  return (
    <div className="panel">
      <div className="label mb-4">LEADERBOARD · models vs policy</div>
      {rows.length === 0 ? (
        <div className="p-4 text-center text-[13px] text-terminal-dim">No model-vs-policy experiments yet — run a 'Brain' experiment in Research Lab.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table w-full text-[13px]">
            <thead>
              <tr>
                {['Brain', 'n', 'Return (95% CI)', 'Survival', 'Paired vs policy', 'Fallback', '$/decision'].map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.brain} className={cx('border-t border-terminal-border', r.insufficient && 'opacity-50')}>
                  <td className="font-semibold">
                    {r.displayName}
                    {r.insufficient && <span className="ml-2 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-normal text-terminal-dim">{r.brain === 'policy' ? 'n<5' : 'pairs<5'}</span>}
                  </td>
                  <td className="text-terminal-dim">{r.runs}</td>
                  <td className="min-w-[220px]">
                    <div className="relative h-4" role="img" aria-label={r.meanReturn === null ? 'No return data' : `Mean return ${signed(r.meanReturn)}${r.returnCI ? `, CI ${signed(r.returnCI[0])} to ${signed(r.returnCI[1])}` : ''}`}>
                      <div className="absolute top-0 h-full w-px bg-white/30" style={{ left: pos(0) }} />
                      {r.returnCI && <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-terminal-accent/40" style={{ left: pos(r.returnCI[0]), width: `calc(${pos(r.returnCI[1])} - ${pos(r.returnCI[0])})` }} />}
                      {r.meanReturn !== null && <div className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-terminal-accent" style={{ left: pos(r.meanReturn) }} />}
                    </div>
                    <div className="text-[11px] text-terminal-dim">
                      {r.meanReturn === null ? '—' : signed(r.meanReturn)}
                      {r.returnCI && ` [${signed(r.returnCI[0])}, ${signed(r.returnCI[1])}]`}
                    </div>
                  </td>
                  <td>{(r.survival * 100).toFixed(0)}%</td>
                  <td>
                    {r.pairedVsPolicy
                      ? `${r.pairedVsPolicy.wins}/${r.pairedVsPolicy.pairs} wins · ${signed(r.pairedVsPolicy.meanDiff)}`
                      : '—'}
                  </td>
                  {/* Share of model calls that fell back to policy; a high rate means the row measures the policy, not the model. */}
                  <td className="text-terminal-dim">{r.fallbackRate === null ? '—' : `${(r.fallbackRate * 100).toFixed(0)}%`}</td>
                  <td className="text-terminal-dim">{r.meanCostPerDecision === null ? '—' : `$${r.meanCostPerDecision.toFixed(4)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** TIMELINE: the Chronicles archive. Every card is one recorded run; selecting one hands it to the replay. */
export default function TimelineView() {
  const board = useGameStore((s) => s.chronicle.board);
  const list = useGameStore((s) => s.chronicle.list);
  const failed = useGameStore((s) => s.chronicle.failed);
  const details = useGameStore((s) => s.chronicle.details);
  const selected = useGameStore((s) => s.selectedRun);
  const selectRun = useGameStore((s) => s.selectRun);

  const { cards, capped } = useMemo(() => {
    const done = (list ?? []).filter((e) => e.status === 'done').sort((a, b) => b.id - a.id);
    return {
      cards: done.slice(0, CHRONICLE_MAX_EXPERIMENTS).flatMap((e) => (details[e.id] ? cardsOf(details[e.id]) : [])),
      capped: done.length > CHRONICLE_MAX_EXPERIMENTS,
    };
  }, [list, details]);

  return (
    <div className="space-y-6">
      {selected && <RunReplay />}
      {board && <Leaderboard rows={board} />}
      <div className="panel">
        <div className="mb-4 flex items-center justify-between">
          <span className="label">CHRONICLES</span>
          {capped && <span className="text-[12px] text-terminal-dim">Showing runs from the {CHRONICLE_MAX_EXPERIMENTS} newest experiments</span>}
        </div>
        {!list ? (
          <div className="p-4 text-center text-[13px] text-terminal-dim">{failed ? 'Could not load chronicles — retrying.' : 'Loading chronicles…'}</div>
        ) : cards.length === 0 ? (
          <div className="p-4 text-center text-[13px] text-terminal-dim">No recorded runs yet — finish an experiment in Research Lab.</div>
        ) : (
          <div className="space-y-2">
            {cards.map((c) => {
              const isSel = selected?.experimentId === c.experimentId && selected.arm === c.arm && selected.seed === c.seed;
              return (
                <button
                  key={`${c.experimentId}|${c.arm}|${c.seed}`}
                  type="button"
                  aria-current={isSel ? 'true' : undefined}
                  aria-label={`${c.experiment}, ${c.arm}, seed ${c.seed}`}
                  onClick={() => selectRun({ experimentId: c.experimentId, arm: c.arm, seed: c.seed })}
                  className={cx('press block w-full rounded-xl px-4 py-3 text-left', isSel ? 'bg-terminal-raised ring-1 ring-terminal-accent/60' : 'bg-white/[0.03] hover:bg-white/[0.06]')}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span className="font-semibold">{c.experiment} <span className="font-normal text-terminal-dim">· {c.arm} · seed {c.seed}</span></span>
                    <span className="text-[12px] text-terminal-dim">{c.date} · ${c.costUsd.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-terminal-dim">{c.brains}</div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] font-medium">
                    {c.outcome.map((o, i) => <span key={i} className={o.tone === 'good' ? 'text-terminal-green' : 'text-terminal-red'}>{o.text}</span>)}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
