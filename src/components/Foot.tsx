import { useGameStore } from '../store/gameStore';
export default function Foot() {
  const sel = useGameStore((s) => s.selectedTicker);
  return (
    <footer className="flex items-center gap-4 border-t border-terminal-border bg-[#0a0c0e] px-3 py-1.5 text-[10px] text-terminal-dim">
      <span>BLACK SHEEP v0.6</span><span>OBSERVATION ONLY — AI FUNDS TRADE, HUMANS WATCH</span><span>CHART: {sel}</span>
    </footer>
  );
}
