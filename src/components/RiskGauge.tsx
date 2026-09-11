import { useGameStore } from '../store/gameStore';
import { cx } from './fmt';
export default function RiskGauge() {
  const riskPct = useGameStore((s) => s.riskPct);
  const riskLabel = useGameStore((s) => s.riskLabel);
  const leverage = useGameStore((s) => s.leverage);
  const marginUsed = useGameStore((s) => s.marginUsedPercent);
  const cashPct = useGameStore((s) => s.cashPct);
  const cash = useGameStore((s) => s.cash);
  const gross = useGameStore((s) => s.grossExposure);
  const liqAt = useGameStore((s) => s.liquidationAt);
  const atRisk = useGameStore((s) => s.atRisk);
  const col = riskPct < 25 ? '#00e676' : riskPct < 55 ? '#d4e157' : riskPct < 80 ? '#ff9800' : '#ff5252';
  const labelCol = riskLabel === 'LOW' ? 'text-terminal-green' : riskLabel === 'MODERATE' ? 'text-[#d4e157]' : riskLabel === 'HIGH' ? 'text-[#ff9800]' : 'text-terminal-red';
  const R = 52; const CX = 70; const CY = 64;
  const arc = (a0: number, a1: number) => { const p = (a: number) => `${(CX + R * Math.cos(a)).toFixed(1)} ${(CY + R * Math.sin(a)).toFixed(1)}`; return `M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}`; };
  const frac = Math.min(1, Math.max(0, riskPct / 100));
  const endA = Math.PI + frac * Math.PI;
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] tracking-widest text-terminal-dim">RISK / EXPOSURE</span>
        <span className="text-[11px] text-terminal-dim">ⓘ</span>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <svg viewBox="0 0 140 76" className="h-[104px] w-full">
            <path d={arc(Math.PI, 2 * Math.PI)} fill="none" stroke="#1e1e1e" strokeWidth="10" strokeLinecap="round" />
            {frac > 0 && <path d={arc(Math.PI, endA)} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" />}
            <text x={CX} y={CY - 6} textAnchor="middle" fill="#fff" fontSize="20" fontWeight="800">{Math.round(riskPct)}%</text>
            <text x={CX} y={CY + 8} textAnchor="middle" fill="#666" fontSize="8">PORTFOLIO RISK</text>
          </svg>
          <div className={cx('text-center text-[12px] font-bold tracking-widest', labelCol)}>{riskLabel}</div>
        </div>
        <div className="flex-1 space-y-1.5 text-[11px]">
          <div className="flex justify-between"><span className="text-terminal-dim">Leverage</span><span className="text-terminal-text">{leverage.toFixed(1)}x</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Margin Used</span><span className="text-terminal-text">{Math.round(marginUsed)}%</span></div>
          <div className="h-1.5 rounded bg-[#1e1e1e]"><div className="h-1.5 rounded" style={{ width: `${Math.min(100, marginUsed)}%`, background: '#ff9800' }} /></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Cash</span><span className="text-terminal-text">${Math.round(cash).toLocaleString()} ({Math.round(cashPct)}%)</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Total Exposure</span><span className="text-terminal-text">${Math.round(gross).toLocaleString()}</span></div>
          <div className="flex justify-between"><span className={cx(atRisk ? 'text-terminal-red font-bold' : 'text-terminal-red/80')}>Liquidation At</span><span className={cx(atRisk ? 'text-terminal-red font-bold' : 'text-terminal-red/80')}>${Math.round(liqAt).toLocaleString()}</span></div>
        </div>
      </div>
    </div>
  );
}
