import { useGameStore } from '../store/gameStore';
export default function TopBar() {
  const tickCount = useGameStore((s) => s.tickCount);
  const m = 10 * 60 + 24 + Math.floor(tickCount / 2);
  const hh = String(Math.floor(m / 60) % 12 || 10).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return (
    <header className="flex items-center gap-4 border-b border-terminal-border bg-[#0a0c0e] px-3 py-2">
      <div className="text-[11px] tracking-widest text-terminal-dim">RAVEN CAPITAL</div>
      <input placeholder="Search companies, news..." className="w-64 rounded border border-terminal-border bg-[#101214] px-2.5 py-1 text-[11px] placeholder:text-[#444]" />
      <div className="ml-auto flex items-center gap-4 text-[11px]">
        <span className="text-terminal-dim">SEP 9, 2025 {hh}:{mm} AM</span>
        <span className="font-semibold text-terminal-green">MARKET OPEN</span>
        <span className="text-terminal-dim">DAY 12 / SEASON 1</span>
      </div>
    </header>
  );
}
