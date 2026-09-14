import { useState } from "react";
import { useGameStore } from "../store/gameStore";
import { fmtMoney } from "./fmt";

const API_BASE = "http://localhost:3001";

export default function LiquidationScreen() {
  const fund = useGameStore((s) => s.fund);
  const causeOfDeath = useGameStore((s) => s.causeOfDeath);
  const peakNav = useGameStore((s) => s.peakNav);
  const nav = useGameStore((s) => s.nav);
  const restart = useGameStore((s) => s.restart);
  const liquidationRivalContext = useGameStore((s) => s.liquidationRivalContext);
  const fundId = useGameStore((s) => s.fundId);
  const [copied, setCopied] = useState(false);
  const startingCapital = fund.startingCapital;
  const finalNav = nav;

  const cardUrl = `${API_BASE}/funds/${fundId}/result-card`;

  async function handleShare() {
    if (!fundId) return;
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div className="flex flex-col items-center gap-6 px-8">
        <div className="text-xs font-bold tracking-[0.3em] text-terminal-red">FUND LIQUIDATED</div>
        <h1 className="text-5xl font-black tracking-tight text-terminal-text">RAVEN CAPITAL</h1>
        <p className="text-sm tracking-widest text-terminal-dim">has been force-closed by the broker</p>
        <div className="mt-4 grid w-full max-w-lg grid-cols-2 gap-x-8 gap-y-4 rounded border border-terminal-border bg-terminal-panel p-6 text-sm">
          <div className="text-terminal-dim">Starting Capital</div>
          <div className="text-right font-bold text-terminal-text">{fmtMoney(startingCapital)}</div>
          <div className="text-terminal-dim">Peak NAV</div>
          <div className="text-right font-bold text-terminal-green">{fmtMoney(peakNav)}</div>
          <div className="text-terminal-dim">Final NAV</div>
          <div className="text-right font-bold text-terminal-red">{fmtMoney(finalNav)}</div>
          <div className="col-span-2 mt-2 border-t border-terminal-border pt-3">
            <div className="text-[10px] uppercase tracking-widest text-terminal-dim">Cause of Death</div>
            <div className="mt-1 text-lg font-bold text-[#ff9800]">{causeOfDeath}</div>
            {liquidationRivalContext && (
              <div className="mt-2 text-sm font-bold text-terminal-red">{liquidationRivalContext}</div>
            )}
          </div>
        </div>
        <button onClick={handleShare} className="rounded bg-terminal-green px-8 py-3 text-sm font-bold tracking-widest text-black hover:bg-[#00cc33]">
          {copied ? "COPIED ✓" : "SHARE RESULT"}
        </button>
        <button onClick={restart} className="rounded bg-terminal-red px-8 py-3 text-sm font-bold tracking-widest text-white hover:bg-[#ff4444]">START AGAIN</button>
      </div>
    </div>
  );
}
