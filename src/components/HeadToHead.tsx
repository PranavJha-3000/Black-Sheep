import { useGameStore } from '../store/gameStore';
import { STARTING_CAPITAL } from '../store/derive';
import { RIVAL_NAME } from '@black-sheep/engine/rival';
import { fmtMoney, fmtPct, fmtSigned, cx } from './fmt';

/**
 * HeadToHead - the "RIVAL WATCH" strip.
 *
 * YOUR NAV vs RIVAL NAV vs the dollar spread, updating live. This is the
 * scoreboard that makes the adversarial relationship legible at a glance:
 * the spread is the single most prominent element because that's the score
 * of the fight.
 */
export default function HeadToHead() {
  const nav = useGameStore((s) => s.nav);
  const rivalNav = useGameStore((s) => s.rivalNav);
  const diff = nav - rivalNav;
  const ahead = diff >= 0;
  const pct = ((nav - STARTING_CAPITAL) / STARTING_CAPITAL) * 100;
  const rPct = ((rivalNav - STARTING_CAPITAL) / STARTING_CAPITAL) * 100;

  return (
    <div className="flex h-full flex-col rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-widest text-terminal-dim">RIVAL WATCH</span>
        <span className={cx('text-[10px] tracking-widest', ahead ? 'text-terminal-green' : 'text-terminal-red')}>
          {ahead ? "YOU'RE AHEAD" : "YOU'RE BEHIND"}
        </span>
      </div>

      <div className="mt-2 grid flex-1 grid-cols-3 items-center gap-2">
        <div>
          <div className="text-[10px] tracking-widest text-terminal-dim">RAVEN CAPITAL — YOU</div>
          <div className="mt-1 text-xl font-bold leading-none text-terminal-text">{fmtMoney(nav)}</div>
          <div className={cx('mt-1 text-[10px]', pct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>
            {fmtPct(pct)}
          </div>
        </div>

        <div className="text-center">
          <div className="text-[10px] tracking-widest text-terminal-dim">SPREAD</div>
          <div className={cx('mt-1 text-[26px] font-bold leading-none', ahead ? 'text-terminal-green' : 'text-terminal-red')}>
            {fmtSigned(diff)}
          </div>
        </div>

        <div className="text-right">
          <div className="text-[10px] tracking-widest text-terminal-dim">{RIVAL_NAME}</div>
          <div className="mt-1 text-xl font-bold leading-none text-terminal-text">{fmtMoney(rivalNav)}</div>
          <div className={cx('mt-1 text-[10px]', rPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>
            {fmtPct(rPct)}
          </div>
        </div>
      </div>
    </div>
  );
}
