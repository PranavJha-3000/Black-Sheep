import { useGameStore } from '../store/gameStore';
import { fmtNum, fmtPct, sparkPath, cx } from './fmt';
const ORDER = ['NOVA', 'TITAN', 'ORBL', 'HELX', 'APXB', 'PULSE'];
export default function Ticker() {
  const companies = useGameStore((s) => s.companies);
  const history = useGameStore((s) => s.priceHistory);
  const sel = useGameStore((s) => s.selectedTicker);
  const select = useGameStore((s) => s.selectTicker);
  return (
    <div className="grid grid-cols-6 gap-2">
      {ORDER.map((t) => {
        const c = companies[t];
        if (!c) return null;
        const chg = ((c.price - c.previousClose) / c.previousClose) * 100;
        const up = chg >= 0;
        const vals = (history[t] ?? [c.price]).slice(-40);
        const active = sel === t;
        return (
          <button key={t} onClick={() => select(t)} className={cx('rounded border px-2 py-1.5 text-left transition-colors', active ? 'border-terminal-green/40 bg-[#101a13]' : 'border-terminal-border bg-terminal-panel hover:border-[#2a2a2a]')}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold tracking-wider text-terminal-text">{t}</span>
              <span className="text-[11px] text-terminal-text">${fmtNum(c.price)}</span>
              <span className={cx('text-[11px] font-semibold', up ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(chg)}</span>
            </div>
            <svg viewBox="0 0 100 24" className="mt-1 h-6 w-full" preserveAspectRatio="none">
              <path d={sparkPath(vals, 100, 24)} fill="none" stroke={up ? '#00e676' : '#ff5252'} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
