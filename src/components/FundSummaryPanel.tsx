import { useGameStore } from "../store/gameStore";
import { fmtMoney, fmtPct, fmtSigned, cx } from "./fmt";

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
  const liquidationCause = useGameStore((s) => s.liquidationCause);

  const pnl = nav - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;
  const isUp = pnl >= 0;

  return (
    <div className="rounded-xl bg-white/[0.03] p-4">
      <div className="text-[11px] text-terminal-dim">{liquidated ? "Final results" : "In focus"}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold">{name}</div>
      {liquidated && (
        <div className="mt-1 text-[11px] font-medium text-terminal-red">
          Liquidated — {liquidationCause ?? "unknown"}
        </div>
      )}
      <div className="mt-3 text-[20px] font-semibold leading-none tracking-[-0.02em]">{fmtMoney(nav)}</div>
      <div className={cx("mt-1.5 text-[12px] font-medium", isUp ? "text-terminal-green" : "text-terminal-red")}>
        {fmtSigned(pnl)} · {fmtPct(pnlPct)}
      </div>
      <div className="mt-3 text-[11px] text-terminal-dim">{positions.length} open position{positions.length === 1 ? "" : "s"}</div>
    </div>
  );
}
