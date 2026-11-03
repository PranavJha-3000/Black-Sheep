import { useGameStore } from '../store/gameStore';
import { fmtNum, fmtPct, sparkPath, cx } from './fmt';
const ORDER = ['NOVA', 'TITAN', 'ORBL', 'HELX', 'APXB', 'PULSE'];
export default function Ticker() {
  const companies = useGameStore((s) => s.companies);
  const history = useGameStore((s) => s.priceHistory);
  const sel = useGameStore((s) => s.selectedTicker);
  const select = useGameStore((s) => s.selectTicker);
  return (
    <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
      {ORDER.map((t) => {
        const c = companies[t];
        if (!c) return null;
        const chg = ((c.price - c.previousClose) / c.previousClose) * 100;
        const up = chg >= 0;
        const vals = (history[t] ?? [c.price]).slice(-40);
        const active = sel === t;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            onClick={() => select(t)}
            className={cx(
              'press rounded-xl border px-3.5 py-3 text-left',
              active ? 'border-terminal-accent/60 bg-terminal-accent/[0.08]' : 'border-terminal-border bg-terminal-panel hover:border-terminal-strong',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">{t}</span>
              <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-medium', up ? 'bg-terminal-green/15 text-terminal-green' : 'bg-terminal-red/15 text-terminal-red')}>{fmtPct(chg)}</span>
            </div>
            <div className="mt-0.5 text-[15px] font-medium tracking-[-0.01em]">${fmtNum(c.price)}</div>
            <svg viewBox="0 0 100 24" className="mt-2 h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
              <path d={sparkPath(vals, 100, 24)} fill="none" stroke={up ? 'rgb(var(--green))' : 'rgb(var(--red))'} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
