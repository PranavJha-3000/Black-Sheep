import { useGameStore } from '../store/gameStore';
import { fmtMoney } from './fmt';
import MarketNews from './MarketNews';
import PositionRow from './PositionRow';
import type { Position } from '../engine/types';
export default function Mid() {
  const positions = useGameStore((s) => s.fund.positions);
  const gross = useGameStore((s) => s.grossExposure);
  const cash = useGameStore((s) => s.cash);
  return (
    <div className="grid grid-cols-12 gap-2">
      <div className="col-span-8 rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">YOUR POSITIONS ({positions.length})</div>
        {positions.length === 0 ? (<div className="rounded border border-dashed border-[#2a2a2a] p-6 text-center text-[12px] text-terminal-dim">No open positions. Select NOVA, enter an amount, and BUY.</div>) : (<PositionsTable positions={positions} />)}
        <div className="mt-1 text-[10px] text-terminal-dim">Gross {fmtMoney(gross)} Cash {fmtMoney(cash)}</div>
      </div>
      <div className="col-span-4 min-h-[280px]"><MarketNews /></div>
    </div>
  );
}
function PositionsTable(props: { positions: Position[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr className="text-left text-[10px] text-terminal-dim"><th className="px-2 py-1 font-normal">TICKER</th><th className="px-2 py-1 font-normal">DIR</th><th className="px-2 py-1 font-normal">SIZE</th><th className="px-2 py-1 font-normal">ENTRY</th><th className="px-2 py-1 font-normal">CUR</th><th className="px-2 py-1 font-normal">PNL</th><th className="px-2 py-1 font-normal">PCT</th><th className="px-2 py-1 font-normal">RISK</th><th className="px-2 py-1 text-right font-normal">ACT</th></tr></thead>
      <tbody>{props.positions.map((x) => (<PositionRow key={x.id} position={x} />))}</tbody>
    </table>
  );
}
