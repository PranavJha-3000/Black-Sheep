import { useGameStore } from "../store/gameStore";
import { fmtMoney, fmtPct } from "./fmt";

/**
 * Compact fund summary panel — accessible any time from the fund view.
 * Shows NAV/PnL/positions.
 */
export default function FundSummaryPanel() {
  const name = useGameStore((s) => s.name);
  const nav = useGameStore((s) => s.nav);
  const startingCapital = useGameStore((s) => s.fund.startingCapital);
  const positions = useGameStore((s) => s.fund.positions);
  const liquidated = useGameStore((s) => s.liquidated);

  const pnl = nav - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;
  const isUp = pnl >= 0;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="text-[10px] uppercase tracking-widest text-terminal-dim">
        {liquidated ? "Final Results" : "Fund Summary"}
      </div>
      <div className="mt-1 text-sm font-bold">{name}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div className="text-terminal-dim">NAV</div>
        <div className="text-right font-bold">{fmtMoney(nav)}</div>
        <div className="text-terminal-dim">PnL</div>
        <div className={`text-right font-bold ${isUp ? "text-terminal-green" : "text-terminal-red"}`}>
          {fmtSigned(pnl)} {fmtPct(pnlPct)}
        </div>
        <div className="text-terminal-dim">Positions</div>
        <div className="text-right">{positions.length} open</div>
      </div>
    </div>
  );
}

function fmtSigned(n: number, dp = 0): string {
  const v = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n >= 0 ? "+" : "-"}$${v}`;
}
