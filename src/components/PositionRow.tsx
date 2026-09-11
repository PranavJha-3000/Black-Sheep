import type { Position } from '../engine/types';
import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtSigned, fmtPct, cx } from './fmt';
import { positionPnl } from '../engine/portfolio';
interface Props { position: Position; }
export default function PositionRow({ position }: Props) {
  const price = useGameStore((s) => s.companies[position.ticker]?.price ?? 0);
  const nav = useGameStore((s) => s.nav);
  const close = useGameStore((s) => s.closePosition);
  const pnl = positionPnl(position, price);
  const notional = price * position.quantity;
  const pnlPct = position.entryPrice > 0 ? (position.direction === 'long' ? (price - position.entryPrice) / position.entryPrice : (position.entryPrice - price) / position.entryPrice) * 100 : 0;
  const risk = nav > 0 ? (notional / nav) * 100 : 0;
  const long = position.direction === 'long';
  const riskCol = risk < 30 ? 'bg-terminal-green' : risk < 60 ? 'bg-[#ff9800]' : 'bg-terminal-red';
  const rowBg = long ? 'bg-[#0c1a10]/60 border-l-2 border-l-terminal-green' : 'bg-[#1c0f0f]/60 border-l-2 border-l-terminal-red';
  const blocks = Math.round(Math.min(100, risk) / 100 * 7);
  return (
    <tr className={cx('border-b border-terminal-border text-[11px]', rowBg)}>
      <td className="px-2 py-2 font-bold">{position.ticker}</td>
      <td className={cx('px-2 py-2 font-semibold', long ? 'text-terminal-green' : 'text-terminal-red')}>{long ? 'LONG' : 'SHORT'}</td>
      <td className="px-2 py-2">{fmtMoney(notional)}</td>
      <td className="px-2 py-2 text-terminal-dim">${position.entryPrice.toFixed(2)}</td>
      <td className="px-2 py-2">${price.toFixed(2)}</td>
      <td className={cx('px-2 py-2 font-semibold', pnl >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>{fmtSigned(pnl)}</td>
      <td className={cx('px-2 py-2', pnl >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(pnlPct)}</td>
      <td className="px-2 py-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-[2px]">{Array.from({ length: 7 }).map((_, i) => (<span key={i} className={cx('h-2 w-2 rounded-[1px]', i < blocks ? riskCol : 'bg-[#242424]')} />))}</span>
          <span className={cx(risk >= 60 ? 'font-bold text-[#ffb74d]' : 'text-terminal-dim')}>{Math.round(risk)}%</span>
          {risk >= 60 && <span>⚠</span>}
        </span>
      </td>
      <td className="px-2 py-2 text-right"><button onClick={() => close(position.id)} className="rounded border border-[#2c2c2c] bg-[#161616] px-2.5 py-1 text-[11px] text-terminal-text hover:border-terminal-red hover:text-terminal-red">Close</button></td>
    </tr>
  );
}
