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
    <div className="panel flex h-full flex-col">
      <div className="label mb-3">Market news</div>
      <ul className="min-h-0 flex-1 divide-y divide-terminal-border overflow-y-auto">
        {last5.length === 0 && <li className="py-6 text-center text-[12px] text-terminal-dim">No news yet.</li>}
        {last5.map((e) => {
          const pos = e.priceImpactPercent >= 0;
          const breaking = Math.abs(e.priceImpactPercent) >= 15;
          const tag = e.ticker ?? (e.type === 'macro' ? 'FED' : 'MKT');
          return (
            <li key={e.id} className="py-3 first:pt-0">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold text-terminal-soft">{tag}</span>
                <span className="text-terminal-dim">{fmtClock(e.timestamp)}</span>
                {breaking && <span className="rounded bg-terminal-red/15 px-1.5 py-px text-[10px] font-semibold text-terminal-red">Breaking</span>}
                <span className={cx('ml-auto font-medium', pos ? 'text-terminal-green' : 'text-terminal-red')}>{fmtMove(e.priceImpactPercent)}</span>
              </div>
              <div className="mt-1 text-[13px] leading-snug text-terminal-text">{e.headline}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
