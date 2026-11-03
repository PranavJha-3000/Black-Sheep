import { useState } from 'react';
import { getFundProfileByName } from '@black-sheep/engine/funds';
import { useGameStore } from '../store/gameStore';
import type { DecisionTrace } from '../../server/observerCore';
import ExposureWarning from './ExposureWarning';
import Hero from './Hero';
import Mid from './Mid';
import RivalPanel from './RivalPanel';
import { cx, fmtMoney, modelName } from './fmt';

/**
 * FUND DETAIL (VISION §13): one fund's mandate, book, memory and decisions —
 * for each decision, what the model researched (tool calls), what it cost and
 * what happened. The focus panels (Hero, Mid, FUND INTEL) follow the selection.
 */
export default function FundDetailView() {
  const selectedFundId = useGameStore((s) => s.selectedFundId);
  const fundId = useGameStore((s) => s.fundId);
  const name = useGameStore((s) => s.name);
  const trace = useGameStore((s) => s.trace);
  const profile = getFundProfileByName(name);

  if (selectedFundId === null) {
    return <div className="panel py-16 text-center text-[13px] text-terminal-dim">Select a fund in Funds to investigate it.</div>;
  }
  if (fundId !== selectedFundId) {
    return <div className="panel py-16 text-center text-[13px] text-terminal-dim">Loading fund…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="text-[13px] capitalize text-terminal-dim">
          {profile ? `${profile.personality} · ${modelName(profile.model)} · max position ${(profile.maxPositionFraction * 100).toFixed(0)}%` : 'Unregistered fund — observed only'}
        </div>
        {profile && (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div><div className="label">Mandate</div><p className="mt-1.5 text-[14px] leading-relaxed text-terminal-soft">{profile.mandate}</p></div>
            <div><div className="label">Strategy</div><p className="mt-1.5 text-[14px] leading-relaxed text-terminal-soft">{profile.strategy}</p></div>
          </div>
        )}
      </div>
      <ExposureWarning />
      <Hero />
      <RivalPanel />
      <Mid />
      <div className="grid grid-cols-12 gap-6">
        <div className="panel col-span-12 lg:col-span-4">
          <div className="label mb-3">Memory <span className="normal-case tracking-normal text-terminal-faint">· persisted notes, not learning</span></div>
          {!trace ? (
            <div className="text-[13px] text-terminal-dim">Loading…</div>
          ) : trace.memory.length === 0 ? (
            <div className="text-[13px] text-terminal-dim">No memories yet.</div>
          ) : (
            <ul className="divide-y divide-terminal-border">
              {trace.memory.map((m, i) => (
                <li key={i} className="py-2.5 text-[13px] leading-snug first:pt-0">
                  <div className="mb-0.5 text-[11px] text-terminal-dim"><span className="capitalize">{m.kind}</span> · tick {m.tickCountAt}</div>
                  {m.content}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel col-span-12 lg:col-span-8">
          <div className="label mb-2">Decisions</div>
          {!trace ? (
            <div className="text-[13px] text-terminal-dim">Loading…</div>
          ) : trace.decisions.length === 0 ? (
            <div className="text-[13px] text-terminal-dim">No decisions yet.</div>
          ) : (
            <div className="divide-y divide-terminal-border">
              {trace.decisions.map((d) => <DecisionRow key={d.id} d={d} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DecisionRow({ d }: { d: DecisionTrace }) {
  const [open, setOpen] = useState(false);
  const filled = d.fillPrice !== null;
  return (
    <div className="text-[13px]">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
        <span className="w-14 shrink-0 text-[12px] text-terminal-dim">t {d.tickCountAt ?? '—'}</span>
        <span className="w-28 shrink-0 font-semibold capitalize">{d.action}{d.ticker ? ` ${d.ticker}` : ''}</span>
        <span className={cx('w-14 shrink-0 text-[12px] capitalize', d.source === 'llm' ? 'text-terminal-accent' : 'text-terminal-dim')}>{d.source}</span>
        <span className="min-w-0 flex-1 truncate text-terminal-soft">{d.reasoning}</span>
        <span className="shrink-0 text-[12px] text-terminal-dim">
          {d.realizedPnL !== null ? fmtMoney(d.realizedPnL) : filled ? `@ ${d.fillPrice!.toFixed(2)}` : d.action === 'hold' ? '' : 'not filled'}
        </span>
        <span className={cx('w-3 shrink-0 text-terminal-dim transition-transform duration-200', open && 'rotate-90')} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="view-in mb-3 ml-[4.25rem] space-y-2 rounded-xl bg-white/[0.03] p-4 text-[12px]">
          <div className="text-[13px] leading-relaxed text-terminal-soft">{d.reasoning}</div>
          <div className="text-terminal-dim">
            Confidence {d.confidence ?? '—'} · {d.model ? modelName(d.model) : 'rule-based policy'}
          </div>
          {d.call ? (
            <div className="space-y-1.5">
              <div className="text-terminal-dim">
                Model call: {d.call.outcome} · {d.call.rounds} rounds · {d.call.inputTokens.toLocaleString()} in / {d.call.outputTokens.toLocaleString()} out ·
                {' '}${d.call.costUsd.toFixed(4)} · {(d.call.latencyMs / 1000).toFixed(1)}s{d.call.error ? ` · ${d.call.error}` : ''}
              </div>
              {d.call.tools.map((t, i) => (
                <details key={i} className="rounded-lg border border-terminal-border bg-black/30 px-3 py-2">
                  <summary className={cx('cursor-pointer', t.ok ? '' : 'text-terminal-red')}>
                    <span className="font-mono text-[11px]">{t.name}</span> {t.input !== '{}' ? t.input : ''} · {t.latencyMs}ms{t.ok ? '' : ' · error'}
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-terminal-dim">{t.output}</pre>
                </details>
              ))}
            </div>
          ) : (
            <div className="text-terminal-dim">No model call — decided by the fund's rule-based policy.</div>
          )}
        </div>
      )}
    </div>
  );
}
