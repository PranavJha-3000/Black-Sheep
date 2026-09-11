import { useGameStore } from '../store/gameStore';
import { cx } from './fmt';
function fmtClock(ts: number): string {
  const base = 10 * 60 + 22;
  const m = base + ts;
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
function fmtMove(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}
export default function MarketNews() {
  const events = useGameStore((s) => s.events);
  const last5 = events.slice(0, 5);
  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] tracking-widest text-terminal-dim">MARKET NEWS</span>
        <span className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-dim">ALL NEWS ▾</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {last5.map((e) => {
          const pos = e.priceImpactPercent >= 0;
          const breaking = Math.abs(e.priceImpactPercent) >= 15;
          const tag = e.ticker ?? (e.type === 'macro' ? 'FED' : 'MKT');
          return (
            <div key={e.id} className={cx('rounded border px-2 py-1.5 text-[11px] leading-snug', breaking ? 'border-terminal-red/60 bg-[#160b0b]' : 'border-terminal-border bg-[#0d0d0d]')}>
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-terminal-dim">{fmtClock(e.timestamp)}</span>
                <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', pos ? 'bg-terminal-green' : 'bg-terminal-red')} />
                <span className="w-10 shrink-0 font-bold text-terminal-dim">{tag}</span>
                {breaking && <span className="rounded bg-terminal-red px-1 text-[9px] font-bold text-white">BREAKING</span>}
                <span className={cx('ml-auto shrink-0 font-bold', pos ? 'text-terminal-green' : 'text-terminal-red')}>{fmtMove(e.priceImpactPercent)}</span>
              </div>
              <div className="mt-0.5 pl-0 text-[#bdbdbd]">{e.headline}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
