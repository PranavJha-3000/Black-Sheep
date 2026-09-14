import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtSigned } from './fmt';
import type { AwaySummary as AwaySummaryData } from '@black-sheep/engine/away';

/**
 * AwaySummary — the "WHILE YOU WERE AWAY" full-screen takeover.
 *
 * Reads the already-gated summary from the store (the server only returns it
 * when `isNotable` passes — see store.fetchAwaySummary). Nothing renders until
 * the player has been gone long enough AND something actually happened, so a
 * bare tab-refresh never trains players to dismiss this screen.
 */

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
}

export default function AwaySummary() {
  const awaySummary = useGameStore((s) => s.awaySummary) as
    | (AwaySummaryData & { notable: boolean })
    | null;
  const dismissAwaySummary = useGameStore((s) => s.dismissAwaySummary);

  if (!awaySummary) return null;

  const { navThen, navNow, navDelta, positions, relevantEvents, confrontations, awayMs, ticksElapsed } =
    awaySummary;
  const navUp = navDelta >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#07090b]/95 font-mono text-terminal-text">
      <div className="w-[640px] max-w-[92vw] rounded border border-terminal-border bg-terminal-panel p-6">
        <div className="text-center">
          <div className="text-[11px] tracking-[0.3em] text-terminal-dim">RAVEN CAPITAL</div>
          <div className="mt-1 text-[22px] font-bold tracking-widest text-terminal-green">
            WHILE YOU WERE AWAY
          </div>
          <div className="mt-1 text-[11px] tracking-widest text-terminal-dim">
            {fmtDuration(awayMs)} · {ticksElapsed} ticks elapsed
          </div>
        </div>

        <div className="mt-5 rounded border border-terminal-border bg-[#0d0d0d] p-4 text-center">
          <div className="text-[10px] tracking-widest text-terminal-dim">YOUR NAV</div>
          <div className="mt-1 flex items-center justify-center gap-4">
            <div>
              <div className="text-[10px] text-terminal-dim">WAS</div>
              <div className="text-[15px] text-terminal-text">{fmtMoney(navThen)}</div>
            </div>
            <div className="text-[20px] text-terminal-dim">→</div>
            <div>
              <div className="text-[10px] text-terminal-dim">NOW</div>
              <div className="text-[15px] text-terminal-text">{fmtMoney(navNow)}</div>
            </div>
          </div>
          <div
            className={`mt-2 text-[18px] font-bold ${
              navUp ? 'text-terminal-green' : 'text-terminal-red'
            }`}
          >
            {fmtSigned(navDelta)} ({((navDelta / navThen) * 100).toFixed(2)}%)
          </div>
        </div>

        {confrontations.length > 0 ? (
          <div className="mt-4">
            <div className="text-[10px] tracking-widest text-terminal-red">⚔ RIVAL MOVES</div>
            {confrontations.map((c, i) => (
              <div key={i} className="mt-2 rounded border border-terminal-red/40 bg-terminal-red/5 p-3">
                <div className="text-[12px] font-bold text-terminal-red">{c.headline}</div>
                <div className="mt-1 text-[11px] italic text-terminal-text/80">"{c.rivalReasoning}"</div>
              </div>
            ))}
          </div>
        ) : null}

        {positions.length > 0 ? (
          <div className="mt-4">
            <div className="text-[10px] tracking-widest text-terminal-dim">POSITION CHANGES</div>
            <div className="mt-2 space-y-1">
              {positions.map((p) => {
                const up = p.pnlDelta >= 0;
                return (
                  <div key={p.ticker} className="flex items-center justify-between rounded border border-terminal-border px-3 py-2">
                    <div>
                      <span className="text-[12px] font-bold text-terminal-text">{p.ticker}</span>
                      <span className="ml-2 text-[10px] uppercase text-terminal-dim">{p.direction}{p.closed ? ' · CLOSED' : ''}</span>
                    </div>
                    <div className={`text-[12px] font-bold ${up ? 'text-terminal-green' : 'text-terminal-red'}`}>{fmtSigned(p.pnlDelta)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {relevantEvents.length > 0 ? (
          <div className="mt-4">
            <div className="text-[10px] tracking-widest text-terminal-dim">EVENTS ON YOUR BOOK</div>
            <div className="mt-2 space-y-1">
              {relevantEvents.map((e, i) => (
                <div key={i} className="flex items-center justify-between rounded border border-terminal-border px-3 py-1.5">
                  <div className="text-[11px] text-terminal-text">
                    <span className="font-bold">{e.ticker}</span>{' '}
                    <span className="text-terminal-dim">{e.headline}</span>
                  </div>
                  <div className={`text-[11px] ${e.priceImpactPercent >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    {e.priceImpactPercent >= 0 ? '+' : ''}{e.priceImpactPercent.toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <button onClick={dismissAwaySummary} className="mt-5 w-full rounded bg-[#00e676] py-3 text-[13px] font-bold tracking-widest text-black hover:bg-[#00ff85]">
          ENTER TERMINAL
        </button>
        <div className="mt-2 text-center text-[10px] text-terminal-dim">The market is live. Your moves are waiting.</div>
      </div>
    </div>
  );
}