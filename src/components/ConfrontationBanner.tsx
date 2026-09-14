import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';

/** How long the alert stays on screen before auto-dismissing. */
const VISIBLE_MS = 8000;

/**
 * ConfrontationBanner - the "Billions moment" alert.
 *
 * Fires when the rival acts directly against the player (opening opposite a
 * live position, or banking a large gain while the player bleeds on the name).
 * Deliberately NOT a news-feed line: it overlays the terminal as a red
 * pulsing alert with the rival's own reasoning beneath the headline, so the
 * moment reads as a moment. Auto-dismisses; dismissible early.
 */
export default function ConfrontationBanner() {
  const confrontation = useGameStore((s) => s.confrontation);
  const dismiss = useGameStore((s) => s.dismissConfrontation);

  useEffect(() => {
    if (!confrontation) return;
    const id = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(id);
  }, [confrontation, dismiss]);

  if (!confrontation) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-1 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex w-full max-w-3xl items-start gap-3 rounded border border-terminal-red bg-[#1a0000] px-3 py-2 shadow-[0_0_12px_rgba(255,49,49,0.25)] animate-pulse">
        <span className="text-sm text-terminal-red">⚔</span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold tracking-widest text-terminal-red">{confrontation.headline}</div>
          <div className="mt-0.5 truncate text-[11px] italic text-terminal-dim">
            &ldquo;{confrontation.rivalReasoning}&rdquo;
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-[11px] leading-none text-terminal-dim hover:text-terminal-red"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
