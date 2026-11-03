import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { fmtNum, fmtPct, cx } from './fmt';
const SECTORS: Record<string, string> = { NOVA: 'Technology', TITAN: 'Automotive', ORBL: 'Aerospace', HELX: 'Biotech', APXB: 'Banking', PULSE: 'Consumer', VOLT: 'Energy', FORGE: 'Industrials', CURA: 'Biotech', LEDG: 'Banking' };
const W = 640; const H = 240; const PAD = 10;
export default function StockChart() {
  const sel = useGameStore((s) => s.selectedTicker);
  const companies = useGameStore((s) => s.companies);
  const history = useGameStore((s) => s.priceHistory);
  const [hover, setHover] = useState<number | null>(null);
  const c = companies[sel];
  if (!c) return null;
  const vals = (history[sel] ?? [c.price]).slice(-90);
  const chg = ((c.price - c.previousClose) / c.previousClose) * 100;
  const up = chg >= 0;
  const tone = up ? 'var(--green)' : 'var(--red)';
  const min = Math.min(...vals); const max = Math.max(...vals);
  const x = (i: number) => PAD + (i / Math.max(1, vals.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${pts} ${(W - PAD).toFixed(1)},${H - PAD}`;
  const dayHigh = Math.max(c.previousClose, ...vals);
  const dayLow = Math.min(c.previousClose, ...vals);
  const hi = hover !== null && hover < vals.length ? hover : null;
  const shown = hi === null ? c.price : vals[hi];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHover(Math.round(Math.min(1, Math.max(0, f)) * (vals.length - 1)));
  };
  return (
    <div className="panel flex h-full flex-col">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[17px] font-semibold">{sel}</span>
            <span className="text-[13px] text-terminal-dim">{c.name}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.025em]">${fmtNum(shown)}</span>
            <span className={cx('text-[14px] font-medium', up ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(chg)}</span>
          </div>
          <div className="mt-1 h-4 text-[11px] text-terminal-dim">{hi === null ? 'Since this page opened' : `Point ${hi + 1} of ${vals.length}`}</div>
        </div>
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-[12px]">
          <dt className="text-terminal-dim">Open</dt><dd className="text-right">${fmtNum(c.previousClose)}</dd>
          <dt className="text-terminal-dim">High</dt><dd className="text-right">${fmtNum(dayHigh)}</dd>
          <dt className="text-terminal-dim">Low</dt><dd className="text-right">${fmtNum(dayLow)}</dd>
          <dt className="text-terminal-dim">Sector</dt><dd className="text-right">{SECTORS[sel] ?? c.sector}</dd>
        </dl>
      </div>
      <div className="relative mt-5 min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-full w-full cursor-crosshair touch-none"
          preserveAspectRatio="none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${sel} price chart`}
        >
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`rgb(${tone})`} stopOpacity="0.22" />
              <stop offset="100%" stopColor={`rgb(${tone})`} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (<line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="rgb(255 255 255 / 0.05)" strokeWidth="1" vectorEffect="non-scaling-stroke" />))}
          <polygon points={area} fill="url(#chart-fill)" />
          <polyline points={pts} fill="none" stroke={`rgb(${tone})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hi !== null && (
            <line x1={x(hi)} x2={x(hi)} y1={PAD} y2={H - PAD} stroke="rgb(255 255 255 / 0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {/* Dots sit outside the stretched SVG so they stay round. */}
        {vals.length > 1 && (
          <span
            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-black/60"
            style={{ left: `${(x(hi ?? vals.length - 1) / W) * 100}%`, top: `${(y(vals[hi ?? vals.length - 1]) / H) * 100}%`, background: `rgb(${tone})` }}
          />
        )}
        <div className="pointer-events-none absolute left-0 top-0 text-[10px] text-terminal-dim">${fmtNum(max)}</div>
        <div className="pointer-events-none absolute bottom-0 left-0 text-[10px] text-terminal-dim">${fmtNum(min)}</div>
      </div>
    </div>
  );
}
