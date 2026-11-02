import { useGameStore } from '../store/gameStore';
export default function TopBar() {
  const tickCount = useGameStore((s) => s.tickCount);
  const fundCount = useGameStore((s) => s.funds.length);
  return (
    <header className="flex items-center gap-4 border-b border-terminal-border bg-[#0a0c0e] px-3 py-2">
      <div className="text-[11px] tracking-widest text-terminal-dim">LIVE WORLD · OBSERVER</div>
      <div className="ml-auto flex items-center gap-4 text-[11px]">
        <span className="text-terminal-dim">TICK {tickCount}</span>
        <span className="text-terminal-dim">{fundCount} FUNDS</span>
        <span className="font-semibold text-terminal-green">MARKET OPEN</span>
      </div>
    </header>
  );
}
