import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { cx } from './fmt';

/**
 * RivalPanel - the "intelligence feed" for the focus fund: the reasoning
 * behind its last decision. While an LLM call is in flight we show a
 * "thinking" line with animating dots so the pause reads as intentional.
 */
export default function RivalPanel() {
  const name = useGameStore((s) => s.name);
  const thinking = useGameStore((s) => s.rivalThinking);
  const lastDecision = useGameStore((s) => s.rivalFund?.lastDecision);

  // Animate trailing dots for the thinking line.
  const [dots, setDots] = useState(0);
  useEffect(() => {
    if (!thinking) return;
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 350);
    return () => clearInterval(id);
  }, [thinking]);

  const reasoning = thinking
    ? `${name} is reviewing positions${'.'.repeat(dots)}`
    : lastDecision
      ? lastDecision.reasoning
      : 'Awaiting first market read…';

  return (
    <div className="panel">
      <div className="flex items-center justify-between">
        <span className="label">Current thesis</span>
        <span className={cx('flex items-center gap-1.5 text-[11px]', thinking ? 'text-terminal-accent' : 'text-terminal-dim')}>
          <span className={cx('h-1.5 w-1.5 rounded-full', thinking ? 'animate-pulse-slow bg-terminal-accent' : 'bg-terminal-green')} />
          {thinking ? 'Thinking' : 'Live'}
        </span>
      </div>
      <p className={cx('mt-3 max-w-[72ch] text-[17px] leading-relaxed tracking-[-0.01em]', thinking ? 'text-terminal-dim' : 'text-terminal-text')}>
        {reasoning}
      </p>
      {!thinking && lastDecision ? (
        <div className="mt-3 flex gap-4 text-[12px] text-terminal-dim">
          <span>Confidence {(lastDecision.confidence * 100).toFixed(0)}%</span>
          <span>Tick {lastDecision.timestamp}</span>
        </div>
      ) : null}
    </div>
  );
}
