import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtNum, cx } from './fmt';
const QUICK = [100_000, 500_000, 1_000_000, 5_000_000];
const LEVS = [1, 2, 3, 5];
export default function OrderTicket() {
  const sel = useGameStore((s) => s.selectedTicker);
  const select = useGameStore((s) => s.selectTicker);
  const companies = useGameStore((s) => s.companies);
  const buy = useGameStore((s) => s.buy);
  const short = useGameStore((s) => s.short);
  const availCash = useGameStore((s) => s.availCash);
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [amount, setAmount] = useState('1000000');
  const [lev, setLev] = useState(1);
  const price = companies[sel]?.price ?? 0;
  const dollars = Math.max(0, Math.floor(Number(amount) || 0));
  const exposure = dollars * lev;
  const shares = price > 0 ? exposure / price : 0;
  const blocked = dollars <= 0 || (side === 'long' ? availCash < dollars : availCash < exposure * 0.5);
  const submit = () => { if (blocked) return; if (side === 'long') buy(sel, dollars, lev); else short(sel, dollars, lev); };
  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-[11px] tracking-widest text-terminal-dim">ORDER TICKET</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => setSide('long')} className={cx('rounded border px-2 py-1.5 text-[11px] font-bold', side === 'long' ? 'border-terminal-green bg-terminal-green/10 text-terminal-green' : 'border-terminal-border text-terminal-dim')}>BUY / LONG</button>
        <button onClick={() => setSide('short')} className={cx('rounded border px-2 py-1.5 text-[11px] font-bold', side === 'short' ? 'border-terminal-red bg-terminal-red/10 text-terminal-red' : 'border-terminal-border text-terminal-dim')}>SHORT</button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <label className="block"><span className="text-terminal-dim">Ticker</span>
          <select value={sel} onChange={(e) => select(e.target.value)} className="mt-1 w-full rounded border border-terminal-border bg-[#0d0d0d] px-2 py-1.5 text-terminal-text">{Object.keys(companies).map((t) => (<option key={t} value={t}>{t}</option>))}</select>
        </label>
        <label className="block"><span className="text-terminal-dim">Amount (USD)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="mt-1 w-full rounded border border-terminal-border bg-[#0d0d0d] px-2 py-1.5 text-terminal-text" />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {QUICK.map((q) => (<button key={q} onClick={() => setAmount(String(q))} className="rounded border border-terminal-border bg-[#141414] px-1 py-1 text-[10px] text-terminal-dim hover:text-terminal-text">${q >= 1_000_000 ? `${q / 1_000_000}M` : `${q / 1000}K`}</button>))}
      </div>
      <div className="mt-2 text-[11px]"><span className="text-terminal-dim">Leverage</span>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          {LEVS.map((l) => (<button key={l} onClick={() => setLev(l)} className={cx('rounded border px-1 py-1 text-[11px] font-bold', lev === l ? 'border-terminal-green text-terminal-green' : 'border-terminal-border text-terminal-dim')}>{l}x</button>))}
        </div>
      </div>
      <div className="mt-2 space-y-1 rounded border border-terminal-border bg-[#0d0d0d] p-2 text-[11px]">
        <div className="flex justify-between"><span className="text-terminal-dim">Price</span><span>${fmtNum(price)}</span></div>
        <div className="flex justify-between"><span className="text-terminal-dim">Est. Shares</span><span>{Math.floor(shares).toLocaleString()}</span></div>
        <div className="flex justify-between"><span className="text-terminal-dim">Est. Cost</span><span>{fmtMoney(dollars)}</span></div>
        <div className="flex justify-between"><span className="text-terminal-dim">Exposure</span><span>{fmtMoney(exposure)}</span></div>
        <div className="flex justify-between"><span className="text-terminal-dim">Avail. Cash</span><span>{fmtMoney(availCash)}</span></div>
      </div>
      <button onClick={submit} disabled={blocked} className={cx('mt-2 rounded py-2.5 text-[12px] font-bold tracking-widest', side === 'long' ? 'bg-[#00e676] text-black hover:bg-[#00ff85]' : 'bg-terminal-red text-white hover:bg-[#ff4444]', blocked && 'cursor-not-allowed opacity-40')}>{side === 'long' ? `BUY ${sel}` : `SHORT ${sel}`}</button>
      <div className="mt-1 text-[10px] text-terminal-dim">Market order. Executes at next tick.</div>
    </div>
  );
}
