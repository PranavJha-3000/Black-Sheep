import { useGameStore } from "../store/gameStore";
import type { Position } from "@black-sheep/engine/types";

function exposurePct(pos: Position, price: number, nav: number): number {
  if (nav <= 0) return 0;
  const notional = price * pos.quantity;
  return (notional / nav) * 100;
}

export default function ExposureWarning() {
  const positions = useGameStore((s) => s.fund.positions);
  const companies = useGameStore((s) => s.companies);
  const nav = useGameStore((s) => s.nav);
  const alerts = positions
    .map((pos) => {
      const price = companies[pos.ticker]?.price ?? 0;
      const pct = exposurePct(pos, price, nav);
      return { ticker: pos.ticker, name: companies[pos.ticker]?.name ?? pos.ticker, pct };
    })
    .filter((a) => a.pct > 50)
    .sort((a, b) => b.pct - a.pct);

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-1">
      {alerts.map((a) => {
        const sev = a.pct > 85 ? "critical" : a.pct > 70 ? "high" : "warn";
        const col = sev === "critical" ? "text-terminal-red" : sev === "high" ? "text-[#ff9800]" : "text-[#ffcc00]";
        const bg = sev === "critical" ? "bg-[#1a0000] border-terminal-red" : sev === "high" ? "bg-[#1a1200] border-[#ff9800]" : "bg-[#1a1a00] border-[#ffcc00]";
        const pulse = sev === "critical" ? "animate-pulse" : sev === "high" ? "animate-pulse-slow" : "";
        return (
          <div key={a.ticker} className={`flex items-center justify-between rounded border px-2 py-1 text-[11px] ${bg} ${pulse}`}>
            <span className={col + " font-bold"}>WARNING</span>
            <span className={col}>You are {Math.round(a.pct)}% exposed to {a.name}</span>
          </div>
        );
      })}
    </div>
  );
}
