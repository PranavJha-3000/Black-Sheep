import type { Position } from '@black-sheep/engine/types';
import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtSigned, fmtPct, cx } from './fmt';
import { positionPnl } from '@black-sheep/engine/portfolio';
interface Props { position: Position; }
export default function PositionRow({ position }: Props) {
  const price = useGameStore((s) => s.companies[position.ticker]?.price ?? 0);
  const nav = useGameStore((s) => s.nav);
  const pnl = positionPnl(position, price);
  const notional = price * position.quantity;
  const pnlPct = position.entryPrice > 0 ? (position.direction === 'long' ? (price - position.entryPrice) / position.entryPrice : (position.entryPrice - price) / position.entryPrice) * 100 : 0;
  const risk = nav > 0 ? (notional / nav) * 100 : 0;
  const long = position.direction === 'long';
  const riskCol = risk < 30 ? 'bg-terminal-green' : risk < 60 ? 'bg-terminal-warn' : 'bg-terminal-red';
  const pc = pnl >= 0 ? 'text-terminal-green' : 'text-terminal-red';
  return (
    <tr className="hover:bg-white/[0.03]">
      <td className="font-semibold">{position.ticker}</td>
      <td><span className={cx('rounded-md px-2 py-0.5 text-[11px] font-medium', long ? 'bg-terminal-green/10 text-terminal-green' : 'bg-terminal-red/10 text-terminal-red')}>{long ? 'Long' : 'Short'}</span></td>
      <td className="text-right">{fmtMoney(notional)}</td>
      <td className="text-right text-terminal-dim">${position.entryPrice.toFixed(2)}</td>
      <td className="text-right">${price.toFixed(2)}</td>
      <td className={cx('text-right font-medium', pc)}>{fmtSigned(pnl)}</td>
      <td className={cx('text-right', pc)}>{fmtPct(pnlPct)}</td>
      <td>
        <span className="flex items-center gap-2" title="Position value as a share of NAV">
          <span className="h-1 w-16 rounded-full bg-white/[0.08]"><span className={cx('block h-1 rounded-full', riskCol)} style={{ width: `${Math.min(100, risk)}%` }} /></span>
          <span className={cx('text-[12px]', risk >= 60 ? 'font-semibold text-terminal-warn' : 'text-terminal-dim')}>{Math.round(risk)}%</span>
        </span>
      </td>
    </tr>
  );
}
