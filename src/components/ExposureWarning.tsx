import { useGameStore } from "../store/gameStore";
import type { Position } from "@black-sheep/engine/types";
import { cx } from "./fmt";

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
    <div className="space-y-2" role="status">
      {alerts.map((a) => {
        const sev = a.pct > 85 ? "critical" : a.pct > 70 ? "high" : "warn";
        const tone = sev === "critical" ? "border-terminal-red/40 bg-terminal-red/10 text-terminal-red animate-pulse" : sev === "high" ? "border-terminal-warn/40 bg-terminal-warn/10 text-terminal-warn" : "border-terminal-caution/30 bg-terminal-caution/10 text-terminal-caution";
        return (
          <div key={a.ticker} className={cx("flex items-center gap-3 rounded-xl border px-4 py-2.5 text-[13px]", tone)}>
            <span className="font-semibold">Concentration</span>
            <span>{Math.round(a.pct)}% of NAV is in {a.name}</span>
          </div>
        );
      })}
    </div>
  );
}
