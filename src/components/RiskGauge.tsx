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
  const tone = riskPct < 25 ? 'var(--green)' : riskPct < 55 ? 'var(--yellow)' : riskPct < 80 ? 'var(--orange)' : 'var(--red)';
  const R = 52; const CX = 70; const CY = 64;
  const arc = (a0: number, a1: number) => { const p = (a: number) => `${(CX + R * Math.cos(a)).toFixed(1)} ${(CY + R * Math.sin(a)).toFixed(1)}`; return `M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}`; };
  const frac = Math.min(1, Math.max(0, riskPct / 100));
  const endA = Math.PI + frac * Math.PI;
  const row = 'flex justify-between py-1.5';
  return (
    <div className="panel h-full">
      <div className="label">Risk & exposure</div>
      <div className="mt-3 flex items-center gap-8">
        <div className="w-[180px] shrink-0">
          <svg viewBox="0 0 140 76" className="w-full" role="img" aria-label={`Portfolio risk ${Math.round(riskPct)} percent, ${riskLabel.toLowerCase()}`}>
            <path d={arc(Math.PI, 2 * Math.PI)} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="9" strokeLinecap="round" />
            {frac > 0 && <path d={arc(Math.PI, endA)} fill="none" stroke={`rgb(${tone})`} strokeWidth="9" strokeLinecap="round" style={{ transition: 'd 400ms ease-out' }} />}
            <text x={CX} y={CY - 8} textAnchor="middle" fill="rgb(var(--text))" fontSize="22" fontWeight="600" letterSpacing="-0.5">{Math.round(riskPct)}%</text>
            <text x={CX} y={CY + 7} textAnchor="middle" fill={`rgb(${tone})`} fontSize="8" fontWeight="600" letterSpacing="0.6">{riskLabel}</text>
          </svg>
        </div>
        <div className="min-w-0 flex-1 divide-y divide-terminal-border text-[13px]">
          <div className={row}><span className="text-terminal-dim">Leverage</span><span>{leverage.toFixed(1)}×</span></div>
          <div className="py-1.5">
            <div className="flex justify-between"><span className="text-terminal-dim">Margin used</span><span>{Math.round(marginUsed)}%</span></div>
            <div className="mt-1.5 h-1 rounded-full bg-white/[0.08]"><div className="h-1 rounded-full bg-terminal-warn transition-[width] duration-500" style={{ width: `${Math.min(100, marginUsed)}%` }} /></div>
          </div>
          <div className={row}><span className="text-terminal-dim">Cash</span><span>${Math.round(cash).toLocaleString()} <span className="text-terminal-dim">({Math.round(cashPct)}%)</span></span></div>
          <div className={row}><span className="text-terminal-dim">Total exposure</span><span>${Math.round(gross).toLocaleString()}</span></div>
          <div className={cx(row, 'text-terminal-red', atRisk && 'font-semibold')}><span>Liquidation at</span><span>${Math.round(liqAt).toLocaleString()}</span></div>
        </div>
      </div>
    </div>
  );
}
