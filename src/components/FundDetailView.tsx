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
    return <div className="p-6 text-center text-[12px] text-terminal-dim">Select a fund in FUNDS to investigate it.</div>;
  }
  if (fundId !== selectedFundId) {
    return <div className="p-6 text-center text-[12px] text-terminal-dim">Loading fund…</div>;
  }

  return (
    <div className="space-y-2">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[14px] font-bold tracking-widest">{name}</span>
          <span className="text-[10px] uppercase tracking-widest text-terminal-dim">
            {profile ? `${profile.personality} · ${modelName(profile.model)} · max position ${(profile.maxPositionFraction * 100).toFixed(0)}%` : 'unregistered fund — observed only'}
          </span>
        </div>
        {profile && (
          <div className="mt-1 space-y-0.5 text-[11px] text-[#bdbdbd]">
            <div><span className="text-terminal-dim">MANDATE </span>{profile.mandate}</div>
            <div><span className="text-terminal-dim">STRATEGY </span>{profile.strategy}</div>
          </div>
        )}
      </div>
      <ExposureWarning />
      <Hero />
      <Mid />
      <RivalPanel />
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 rounded border border-terminal-border bg-terminal-panel p-3 lg:col-span-4">
          <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">MEMORY (persisted notes, not learning)</div>
          {!trace ? (
            <div className="text-[11px] text-terminal-dim">Loading…</div>
          ) : trace.memory.length === 0 ? (
            <div className="text-[11px] text-terminal-dim">No memories yet.</div>
          ) : (
            <div className="space-y-1.5">
              {trace.memory.map((m, i) => (
                <div key={i} className="text-[11px] leading-snug">
                  <span className="text-terminal-dim">[{m.kind} t={m.tickCountAt}] </span>
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-12 rounded border border-terminal-border bg-terminal-panel p-3 lg:col-span-8">
          <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">DECISIONS</div>
          {!trace ? (
            <div className="text-[11px] text-terminal-dim">Loading…</div>
          ) : trace.decisions.length === 0 ? (
            <div className="text-[11px] text-terminal-dim">No decisions yet.</div>
          ) : (
            <div className="space-y-1">
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
    <div className="border-t border-terminal-border py-1 text-[11px]">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-baseline gap-2 text-left">
        <span className="w-14 shrink-0 text-terminal-dim">t={d.tickCountAt ?? '—'}</span>
        <span className="w-24 shrink-0 font-bold">{d.action.toUpperCase()}{d.ticker ? ` ${d.ticker}` : ''}</span>
        <span className={cx('w-16 shrink-0 uppercase', d.source === 'llm' ? 'text-terminal-green' : 'text-terminal-dim')}>{d.source}</span>
        <span className="min-w-0 flex-1 truncate text-[#bdbdbd]">{d.reasoning}</span>
        <span className="shrink-0 text-terminal-dim">
          {d.realizedPnL !== null ? fmtMoney(d.realizedPnL) : filled ? `@ ${d.fillPrice!.toFixed(2)}` : d.action === 'hold' ? '' : 'not filled'}
        </span>
        <span className="w-3 shrink-0 text-terminal-dim">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 pl-16 text-[10px]">
          <div className="text-[#bdbdbd]">{d.reasoning}</div>
          <div className="text-terminal-dim">
            confidence {d.confidence ?? '—'} · {d.model ? modelName(d.model) : 'rule-based policy'}
          </div>
          {d.call ? (
            <div className="space-y-1">
              <div className="text-terminal-dim">
                model call: {d.call.outcome} · {d.call.rounds} rounds · {d.call.inputTokens.toLocaleString()} in / {d.call.outputTokens.toLocaleString()} out ·
                {' '}${d.call.costUsd.toFixed(4)} · {(d.call.latencyMs / 1000).toFixed(1)}s{d.call.error ? ` · ${d.call.error}` : ''}
              </div>
              {d.call.tools.map((t, i) => (
                <details key={i} className="rounded border border-terminal-border bg-[#0d0d0d] px-2 py-1">
                  <summary className={cx('cursor-pointer', t.ok ? '' : 'text-terminal-red')}>
                    {t.name} {t.input !== '{}' ? t.input : ''} · {t.latencyMs}ms{t.ok ? '' : ' · error'}
                  </summary>
                  <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-terminal-dim">{t.output}</pre>
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
