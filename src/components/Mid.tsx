import { useGameStore } from '../store/gameStore';
import { fmtMoney } from './fmt';
import MarketNews from './MarketNews';
import PositionRow from './PositionRow';
import type { Position } from '@black-sheep/engine/types';
export default function Mid() {
  const positions = useGameStore((s) => s.fund.positions);
  const gross = useGameStore((s) => s.grossExposure);
  const cash = useGameStore((s) => s.cash);
  return (
    <div className="grid grid-cols-12 items-start gap-6">
      <div className="panel col-span-12 lg:col-span-8">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="label">Positions · {positions.length}</span>
          <span className="text-[12px] text-terminal-dim">Gross {fmtMoney(gross)} · Cash {fmtMoney(cash)}</span>
        </div>
        {positions.length === 0 ? (<div className="py-10 text-center text-[13px] text-terminal-dim">No open positions.</div>) : (<PositionsTable positions={positions} />)}
      </div>
      <div className="col-span-12 min-h-[280px] lg:col-span-4"><MarketNews /></div>
    </div>
  );
}
function PositionsTable(props: { positions: Position[] }) {
  return (
    <table className="data-table w-full border-collapse text-[13px]">
      <thead><tr><th>Ticker</th><th>Side</th><th className="!text-right">Size</th><th className="!text-right">Entry</th><th className="!text-right">Price</th><th className="!text-right">P&amp;L</th><th className="!text-right">Return</th><th>Weight</th></tr></thead>
      <tbody>{props.positions.map((x) => (<PositionRow key={x.id} position={x} />))}</tbody>
    </table>
  );
}
