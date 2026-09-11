import { useEffect } from "react";
import Ticker from "./Ticker";
import StockChart from "./StockChart";
import OrderTicket from "./OrderTicket";
import TopBar from "./TopBar";
import Hero from "./Hero";
import Mid from "./Mid";
import Foot from "./Foot";
import LiquidationScreen from "./LiquidationScreen";
import ExposureWarning from "./ExposureWarning";
import { useGameStore } from "../store/gameStore";
export default function Terminal() {
  const tick = useGameStore((s) => s.tick);
  const liquidated = useGameStore((s) => s.liquidated);
  useEffect(() => {
    const id = setInterval(() => useGameStore.getState().tick(), 2000);
    return () => clearInterval(id);
  }, [tick]);
  return (
    <div className="flex h-screen overflow-hidden bg-[#07090b] font-mono text-terminal-text">
      <aside className="flex w-[168px] shrink-0 flex-col border-r border-terminal-border bg-[#0a0c0e]">
        <div className="border-b border-terminal-border p-3">
          <div className="text-[13px] font-bold tracking-widest">RAVEN CAPITAL</div>
          <div className="text-[9px] tracking-widest text-terminal-dim">DISCIPLINE COMPOUNDS</div>
        </div>
        <SidebarNav />
        <div className="border-t border-terminal-border p-2 text-[10px] text-terminal-green">MARKET OPEN</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          <Ticker />
          <ExposureWarning />
          <Hero />
          <Mid />
          <div className="grid grid-cols-12 gap-2 pb-1">
            <div className="col-span-8 min-h-[260px]"><StockChart /></div>
            <div className="col-span-4"><OrderTicket /></div>
          </div>
        </div>
        <Foot />
      </div>
      {liquidated && <LiquidationScreen />}
    </div>
  );
}
const NAV_ITEMS = ["TRADING", "PORTFOLIO", "MARKET", "RESEARCH", "INTELLIGENCE", "FUND", "LEADERBOARD", "SETTINGS"];
function SidebarNav() {
  return (
    <nav className="flex-1 space-y-0.5 p-2">
      {NAV_ITEMS.map((n) => (
        <div key={n} className={n === "TRADING" ? "rounded bg-[#161616] px-2.5 py-2 text-[11px] tracking-wider text-white" : "rounded px-2.5 py-2 text-[11px] tracking-wider text-terminal-dim"}>{n}</div>
      ))}
    </nav>
  );
}
