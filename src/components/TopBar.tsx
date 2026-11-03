import { useGameStore, NAV_ITEMS } from '../store/gameStore';
export default function TopBar() {
  const tickCount = useGameStore((s) => s.tickCount);
  const fundCount = useGameStore((s) => s.funds.length);
  const view = useGameStore((s) => s.view);
  const fundName = useGameStore((s) => s.name);
  // Wayfinding: the header names where you are.
  const title = view === 'fund' ? fundName : NAV_ITEMS.find((n) => n.view === view)?.label ?? '';
  return (
    <header className="material sticky top-0 z-10 flex items-center gap-6 border-b border-terminal-border bg-terminal-bg/70 px-8 py-4 backdrop-blur-xl backdrop-saturate-150">
      <div className="min-w-0">
        <div className="text-[11px] text-terminal-dim">Live world · Observer</div>
        <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
      </div>
      <div className="ml-auto flex items-center gap-5 text-[12px] text-terminal-dim">
        <span>Tick <span className="text-terminal-text">{tickCount.toLocaleString('en-US')}</span></span>
        <span>{fundCount} funds</span>
        <span className="flex items-center gap-2 rounded-full bg-terminal-green/10 px-2.5 py-1 font-medium text-terminal-green">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-terminal-green" />
          Market open
        </span>
      </div>
    </header>
  );
}
