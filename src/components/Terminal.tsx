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
import { useGameStore, NAV_ITEMS } from "../store/gameStore";
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
    <div className="flex h-screen overflow-hidden bg-terminal-bg font-sans text-terminal-text">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-terminal-border bg-terminal-chrome">
        <div className="px-5 pb-5 pt-6">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">Black Sheep</div>
          <div className="mt-0.5 text-[12px] text-terminal-dim">Autonomous fund lab</div>
        </div>
        <SidebarNav />
        <div className="p-3">
          <FundSummaryPanel />
        </div>
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] space-y-6 px-8 pb-10 pt-6">
            <Ticker />
            <div key={view} className="view-in space-y-6">
              {view === "world" && <WorldView />}
              {view === "funds" && <FundsView />}
              {view === "fund" && <FundDetailView />}
              {view === "activity" && <ActivityView />}
              {view === "analytics" && <AnalyticsView />}
              {view === "lab" && <ResearchLabView />}
            </div>
          </div>
        </main>
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
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 min-h-[340px] lg:col-span-8"><StockChart /></div>
        <div className="col-span-12 min-h-[340px] lg:col-span-4"><MarketNews /></div>
      </div>
    </>
  );
}

function SidebarNav() {
  const view = useGameStore((s) => s.view);
  const setView = useGameStore((s) => s.setView);
  const selectedFundId = useGameStore((s) => s.selectedFundId);
  return (
    <nav className="flex-1 space-y-0.5 px-3">
      {NAV_ITEMS.map((n) => {
        // FUND DETAIL needs a selection (made from FUNDS or the strip); later-stage views are listed, not live.
        const disabled = n.view === null || (n.view === "fund" && selectedFundId === null);
        const active = n.view === view;
        return (
          <button
            key={n.label}
            type="button"
            disabled={disabled}
            aria-current={active ? "page" : undefined}
            onClick={() => n.view && setView(n.view)}
            title={n.view === null ? "Coming in a later stage" : n.view === "fund" && disabled ? "Select a fund first" : undefined}
            className={cx(
              "press flex w-full items-center justify-between rounded-lg px-3 py-[7px] text-left text-[13px]",
              active ? "bg-terminal-raised font-medium text-terminal-text" : disabled ? "cursor-default text-terminal-faint" : "text-terminal-soft hover:bg-white/[0.04] hover:text-terminal-text",
            )}
          >
            {n.label}
            {n.view === null && <span className="text-[10px] text-terminal-faint">Soon</span>}
          </button>
        );
      })}
    </nav>
  );
}
