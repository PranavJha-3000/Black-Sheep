import { useGameStore, RIVAL_NAME } from '../store/gameStore';
import { fmtMoney, fmtPct, sparkPath, cx } from './fmt';
export default function RivalFund() {
  const rivalNav = useGameStore((s) => s.rivalNav);
  const rivalHist = useGameStore((s) => s.rivalHistory);
  const nav = useGameStore((s) => s.nav);
  const diff = nav - rivalNav;
  const ahead = diff >= 0;
  const rPct = ((rivalNav - 10_000_000) / 10_000_000) * 100;
  const vals = rivalHist.slice(-60);
  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-widest text-terminal-dim">RIVAL FUND</span>
        <span className="text-[11px] text-terminal-dim">VIEW ALL →</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2a2a2a] text-xl text-terminal-dim">∧</div>
        <div className="flex-1">
          <div className="text-[11px] tracking-widest text-terminal-dim">{RIVAL_NAME}</div>
          <div className="text-lg font-bold text-terminal-text">{fmtMoney(rivalNav)}</div>
          <div className={cx('text-[11px]', rPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(rPct)}</div>
        </div>
        <svg viewBox="0 0 100 36" className="h-9 w-24" preserveAspectRatio="none">
          <path d={sparkPath(vals, 100, 36)} fill="none" stroke={rPct >= 0 ? '#00e676' : '#ff5252'} strokeWidth="1.5" />
        </svg>
      </div>
      <div className="mt-2 border-t border-terminal-border pt-2">
        <div className="text-[10px] tracking-widest text-terminal-dim">{ahead ? "YOU'RE AHEAD BY" : "YOU'RE BEHIND BY"}</div>
        <div className={cx('text-xl font-bold', ahead ? 'text-terminal-green' : 'text-terminal-red')}>{fmtMoney(Math.abs(diff))}</div>
      </div>
    </div>
  );
}
