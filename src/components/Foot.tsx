import { useGameStore } from '../store/gameStore';
export default function Foot() {
  const sel = useGameStore((s) => s.selectedTicker);
  return (
    <footer className="flex items-center gap-4 border-t border-terminal-border bg-[#0a0c0e] px-3 py-1.5 text-[10px] text-terminal-dim">
      <span className="text-terminal-green">MARKET OPEN</span><span>v0.2</span><span>NEXT: FED DECISION 3H 35M</span><span>SELECTED: {sel}</span>
    </footer>
  );
}
