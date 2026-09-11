import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtSigned, fmtPct, cx } from './fmt';
import RiskGauge from './RiskGauge';
import RivalFund from './RivalFund';
export default function Hero() {
  const nav = useGameStore((s) => s.nav);
  const dailyPnl = useGameStore((s) => s.dailyPnl);
  const dailyPct = useGameStore((s) => s.dailyPnlPct);
  const cash = useGameStore((s) => s.cash);
  const lev = useGameStore((s) => s.leverage);
  const n = useGameStore((s) => s.fund.positions.length);
  const pc = dailyPnl >= 0 ? 'text-terminal-green' : 'text-terminal-red';
  return (
    <div className="grid grid-cols-12 gap-2">
      <div className="col-span-4 rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-[11px] tracking-widest text-terminal-dim">NET ASSET VALUE</div>
        <div className="mt-1 text-[34px] font-bold leading-none text-[#c8f5d6]">{fmtMoney(nav)}</div>
        <div className={cx('mt-1.5 text-[15px] font-semibold', pc)}>{fmtSigned(dailyPnl)} <span>({fmtPct(dailyPct)})</span> <span className="text-[11px] font-normal text-terminal-dim">TODAY</span></div>
        <div className="mt-2 grid grid-cols-3 gap-1 border-t border-terminal-border pt-2 text-[10px]">
          <span className="text-terminal-dim">Cash</span><span className="col-span-2 text-right">{fmtMoney(cash)}</span>
          <span className="text-terminal-dim">Positions</span><span className="col-span-2 text-right">{n}</span>
          <span className="text-terminal-dim">Leverage</span><span className="col-span-2 text-right">{lev.toFixed(2)}x</span>
        </div>
      </div>
      <div className="col-span-5"><RiskGauge /></div>
      <div className="col-span-3"><RivalFund /></div>
    </div>
  );
}
