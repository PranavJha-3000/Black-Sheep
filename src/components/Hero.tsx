import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtSigned, fmtPct, cx } from './fmt';
import RiskGauge from './RiskGauge';
export default function Hero() {
  const nav = useGameStore((s) => s.nav);
  const dailyPnl = useGameStore((s) => s.dailyPnl);
  const dailyPct = useGameStore((s) => s.dailyPnlPct);
  const cash = useGameStore((s) => s.cash);
  const lev = useGameStore((s) => s.leverage);
  const n = useGameStore((s) => s.fund.positions.length);
  const pc = dailyPnl >= 0 ? 'text-terminal-green' : 'text-terminal-red';
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="panel col-span-12 lg:col-span-5">
        <div className="label">Net asset value</div>
        <div className="mt-3 text-[44px] font-semibold leading-none tracking-[-0.03em]">{fmtMoney(nav)}</div>
        <div className={cx('mt-2 text-[15px] font-medium', pc)}>{fmtSigned(dailyPnl)} ({fmtPct(dailyPct)}) <span className="font-normal text-terminal-dim">today</span></div>
        <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-terminal-border pt-4 text-[13px]">
          <div><dt className="text-[11px] text-terminal-dim">Cash</dt><dd className="mt-0.5">{fmtMoney(cash)}</dd></div>
          <div><dt className="text-[11px] text-terminal-dim">Positions</dt><dd className="mt-0.5">{n}</dd></div>
          <div><dt className="text-[11px] text-terminal-dim">Leverage</dt><dd className="mt-0.5">{lev.toFixed(2)}×</dd></div>
        </dl>
      </div>
      <div className="col-span-12 lg:col-span-7"><RiskGauge /></div>
    </div>
  );
}
