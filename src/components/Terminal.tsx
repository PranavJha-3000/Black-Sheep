import { useEffect } from "react";
import Ticker from "./Ticker";
import StockChart from "./StockChart";
import TopBar from "./TopBar";
import Foot from "./Foot";
import FundSummaryPanel from "./FundSummaryPanel";
import FundsStrip from "./FundsStrip";
import MarketNews from "./MarketNews";
import FundsView from "./FundsView";
import FundDetailView from "./FundDetailView";
import ActivityView from "./ActivityView";
import AnalyticsView from "./AnalyticsView";
import ResearchLabView from "./ResearchLabView";
import { useGameStore, type ObserverView } from "../store/gameStore";
import { cx } from "./fmt";

/**
 * The observation terminal (VISION §13). Humans watch; nothing here trades.
 * WORLD, FUNDS, FUND DETAIL, ACTIVITY, RESEARCH LAB and ANALYTICS are live;
 * TIMELINE is listed but arrives in a later stage.
 */
export default function Terminal() {
  useEffect(() => {
    // Poll the public world every ~2.5s; the server is the source of truth.
    void useGameStore.getState().poll();
    const id = setInterval(() => {
      void useGameStore.getState().poll();
    }, 2500);
    return () => clearInterval(id);
  }, []);
  const view = useGameStore((s) => s.view);
  return (
    <div className="flex h-screen overflow-hidden bg-[#07090b] font-mono text-terminal-text">
      <aside className="flex w-[168px] shrink-0 flex-col border-r border-terminal-border bg-[#0a0c0e]">
        <div className="border-b border-terminal-border p-3">
          <div className="text-[13px] font-bold tracking-widest">BLACK SHEEP</div>
          <div className="text-[9px] tracking-widest text-terminal-dim">AUTONOMOUS FUND LAB</div>
        </div>
        <SidebarNav />
        <div className="border-t border-terminal-border p-2">
          <FundSummaryPanel />
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          <Ticker />
          {view === "world" && <WorldView />}
          {view === "funds" && <FundsView />}
          {view === "fund" && <FundDetailView />}
          {view === "activity" && <ActivityView />}
          {view === "analytics" && <AnalyticsView />}
          {view === "lab" && <ResearchLabView />}
        </div>
        <Foot />
      </div>
    </div>
  );
}

/** WORLD: market conditions and every fund at a glance. */
function WorldView() {
  return (
    <>
      <FundsStrip />
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12 min-h-[260px] lg:col-span-8"><StockChart /></div>
        <div className="col-span-12 min-h-[260px] lg:col-span-4"><MarketNews /></div>
      </div>
    </>
  );
}

const NAV_ITEMS: { label: string; view: ObserverView | null }[] = [
  { label: "WORLD", view: "world" },
  { label: "FUNDS", view: "funds" },
  { label: "FUND DETAIL", view: "fund" },
  { label: "ACTIVITY", view: "activity" },
  { label: "TIMELINE", view: null },
  { label: "RESEARCH LAB", view: "lab" },
  { label: "ANALYTICS", view: "analytics" },
];

function SidebarNav() {
  const view = useGameStore((s) => s.view);
  const setView = useGameStore((s) => s.setView);
  const selectedFundId = useGameStore((s) => s.selectedFundId);
  return (
    <nav className="flex-1 space-y-0.5 p-2">
      {NAV_ITEMS.map((n) => {
        // FUND DETAIL needs a selection (made from FUNDS or the strip); later-stage views are listed, not live.
        const disabled = n.view === null || (n.view === "fund" && selectedFundId === null);
        return (
          <button
            key={n.label}
            type="button"
            disabled={disabled}
            onClick={() => n.view && setView(n.view)}
            title={n.view === null ? "Coming in a later stage" : undefined}
            className={cx(
              "block w-full rounded px-2.5 py-2 text-left text-[11px] tracking-wider",
              n.view === view ? "bg-[#161616] text-white" : disabled ? "cursor-default text-[#3a3a3a]" : "text-terminal-dim hover:text-white",
            )}
          >
            {n.label}
          </button>
        );
      })}
    </nav>
  );
}
