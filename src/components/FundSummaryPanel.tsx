import { useState } from "react";
import { useGameStore } from "../store/gameStore";
import { fmtMoney, fmtPct } from "./fmt";

const API_BASE = "http://localhost:3001";

/**
 * Compact fund summary panel — accessible any time from the fund view.
 * Shows NAV/PnL/positions and a SHARE button that copies the result-card
 * link. Works at any NAV: a fund up 300% is just as shareable as one that
 * blew up.
 */
export default function FundSummaryPanel() {
  const fundId = useGameStore((s) => s.fundId);
  const name = useGameStore((s) => s.name);
  const nav = useGameStore((s) => s.nav);
  const startingCapital = useGameStore((s) => s.fund.startingCapital);
  const positions = useGameStore((s) => s.fund.positions);
  const liquidated = useGameStore((s) => s.liquidated);
  const [copied, setCopied] = useState(false);

  const pnl = nav - startingCapital;
  const pnlPct = startingCapital > 0 ? (pnl / startingCapital) * 100 : 0;
  const isUp = pnl >= 0;

  const cardUrl = `${API_BASE}/funds/${fundId}/result-card`;

  async function handleShare() {
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select a text field (rarely needed in modern browsers)
      setCopied(false);
    }
  }

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
      <button
        onClick={handleShare}
        className="mt-3 w-full rounded bg-terminal-green px-3 py-1.5 text-xs font-bold tracking-widest text-black hover:bg-[#00cc33]"
      >
        {copied ? "COPIED ✓" : "SHARE"}
      </button>
    </div>
  );
}

function fmtSigned(n: number, dp = 0): string {
  const v = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `${n >= 0 ? "+" : "-"}$${v}`;
}
