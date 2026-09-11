import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { fmtNum, fmtPct, cx } from './fmt';
const SECTORS: Record<string, string> = { NOVA: 'Technology', TITAN: 'Automotive', ORBL: 'Aerospace', HELX: 'Biotech', APXB: 'Banking', PULSE: 'Consumer' };
const TF = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];
export default function StockChart() {
  const sel = useGameStore((s) => s.selectedTicker);
  const companies = useGameStore((s) => s.companies);
  const history = useGameStore((s) => s.priceHistory);
  const [tf, setTf] = useState('1D');
  const c = companies[sel];
  if (!c) return null;
  const vals = (history[sel] ?? [c.price]).slice(-90);
  const chg = ((c.price - c.previousClose) / c.previousClose) * 100;
  const up = chg >= 0;
  const min = Math.min(...vals); const max = Math.max(...vals);
  const W = 520; const H = 190; const pad = 8;
  const pts = vals.map((v, i) => `${(pad + (i / Math.max(1, vals.length - 1)) * (W - pad * 2)).toFixed(1)},${(H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2)).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${pts} ${(W - pad).toFixed(1)},${H - pad}`;
  const dayHigh = Math.max(c.previousClose, ...vals);
  const dayLow = Math.min(c.previousClose, ...vals);
  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-bold">{sel}</span>
          <span className="text-sm">${fmtNum(c.price)}</span>
          <span className={cx('text-sm font-semibold', up ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(chg)}</span>
        </div>
        <div className="flex gap-1">
          {TF.map((t) => (<button key={t} onClick={() => setTf(t)} className={cx('rounded border px-2 py-0.5 text-[10px]', tf === t ? 'border-[#3a3a3a] bg-[#222] text-white' : 'border-transparent text-terminal-dim hover:text-terminal-text')}>{t}</button>))}
        </div>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
            {[0.2, 0.4, 0.6, 0.8].map((f) => (<line key={f} x1={pad} x2={W - pad} y1={H * f} y2={H * f} stroke="#161616" strokeWidth="1" />))}
            <polygon points={area} fill={up ? 'rgba(0,230,118,0.12)' : 'rgba(255,82,82,0.12)'} />
            <polyline points={pts} fill="none" stroke={up ? '#00e676' : '#ff5252'} strokeWidth="1.6" />
            {vals.length > 1 && (() => { const [lx, ly] = pts.split(' ').pop()!.split(','); return <circle cx={lx} cy={ly} r="3" fill={up ? '#00e676' : '#ff5252'} />; })()}
          </svg>
          <div className="flex justify-between text-[10px] text-terminal-dim"><span>09:30</span><span>11:00</span><span>12:30</span><span>14:00</span><span>16:00</span></div>
        </div>
        <div className="w-36 shrink-0 space-y-1.5 text-[11px]">
          <div className="flex justify-between"><span className="text-terminal-dim">Open</span><span>${fmtNum(c.previousClose)}</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Day High</span><span>${fmtNum(dayHigh)}</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Day Low</span><span>${fmtNum(dayLow)}</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Volume</span><span>{(c.price * 10000 / 1e6).toFixed(1)}M</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Market Cap</span><span>${(c.price * 1e9 / 1e9).toFixed(1)}B</span></div>
          <div className="flex justify-between"><span className="text-terminal-dim">Sector</span><span>{SECTORS[sel] ?? c.sector}</span></div>
        </div>
      </div>
    </div>
  );
}
