import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { RIVAL_NAME } from '@black-sheep/engine/rival';
import { STARTING_CAPITAL } from '../store/derive';
import { fmtMoney, fmtPct, cx } from './fmt';

/**
 * RivalPanel - the "intelligence feed" for the rival fund.
 *
 * Shows the rival's real NAV (mark-to-market of its actual book) and, most
 * importantly, the reasoning behind its last decision. While an LLM call is in
 * flight we show a terminal-style "thinking" line with animating dots so the
 * pause reads as intentional, not as lag.
 */
export default function RivalPanel() {
  const rivalNav = useGameStore((s) => s.rivalNav);
  const thinking = useGameStore((s) => s.rivalThinking);
  const lastDecision = useGameStore((s) => s.rivalFund?.lastDecision);

  // Animate trailing dots for the thinking line.
  const [dots, setDots] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 350);
    return () => clearInterval(id);
  }, [thinking]);

  const rPct = ((rivalNav - STARTING_CAPITAL) / STARTING_CAPITAL) * 100;

  const reasoning = thinking
    ? `${RIVAL_NAME} is reviewing positions${'.'.repeat(dots)}`
    : lastDecision
      ? lastDecision.reasoning
      : 'Awaiting first market read...';

  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-widest text-terminal-dim">RIVAL INTEL</span>
        <span className={cx('text-[10px] tracking-widest', thinking ? 'text-terminal-green' : 'text-terminal-dim')}>
          {thinking ? 'THINKING' : 'LIVE'}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#2a2a2a] text-xl text-terminal-dim">
          ∧
        </div>
        <div className="flex-1">
          <div className="text-[11px] tracking-widest text-terminal-dim">{RIVAL_NAME}</div>
          <div className="text-lg font-bold text-terminal-text">{fmtMoney(rivalNav)}</div>
          <div className={cx('text-[11px]', rPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>
            {fmtPct(rPct)}
          </div>
        </div>
      </div>

      <div className="mt-2 border-t border-terminal-border pt-2">
        <div className="text-[10px] tracking-widest text-terminal-dim">THESIS</div>
        <div className="mt-1 min-h-[3rem] text-[11px] leading-relaxed text-terminal-text">
          {reasoning}
        </div>
        {!thinking && lastDecision ? (
          <div className="mt-1 flex items-center justify-between text-[10px] text-terminal-dim">
            <span>conf {(lastDecision.confidence * 100).toFixed(0)}%</span>
            <span>tick {lastDecision.timestamp}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
