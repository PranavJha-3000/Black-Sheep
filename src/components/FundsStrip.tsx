import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtPct, cx, modelName } from './fmt';

/**
 * FundsStrip - every AI fund in the world at a glance: name, model, NAV,
 * return and status. A card opens that fund's FUND DETAIL.
 */
export default function FundsStrip() {
  const funds = useGameStore((s) => s.funds);
  const openFund = useGameStore((s) => s.openFund);
  if (funds.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {funds.map((f) => {
        const status = f.liquidated ? 'Liquidated' : f.thinking ? 'Thinking' : 'Live';
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => openFund(f.id)}
            className="panel press group text-left hover:border-terminal-strong"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[14px] font-semibold">{f.name}</span>
              <span
                className={cx(
                  'flex shrink-0 items-center gap-1.5 text-[11px]',
                  f.liquidated ? 'text-terminal-red' : f.thinking ? 'text-terminal-accent' : 'text-terminal-dim',
                )}
              >
                <span className={cx('h-1.5 w-1.5 rounded-full', f.liquidated ? 'bg-terminal-red' : f.thinking ? 'bg-terminal-accent animate-pulse-slow' : 'bg-terminal-green')} />
                {status}
              </span>
            </div>
            <div className="mt-0.5 text-[12px] capitalize text-terminal-dim">
              {f.personality ?? '—'} · {modelName(f.model)}
            </div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[22px] font-semibold tracking-[-0.02em]">{fmtMoney(f.nav)}</span>
              <span className={cx('text-[13px] font-medium', f.pnlPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>
                {fmtPct(f.pnlPct)}
              </span>
            </div>
            <div className="mt-3 flex justify-between gap-3 border-t border-terminal-border pt-3 text-[11px] text-terminal-dim">
              <span className="truncate">
                {f.lastAction ?? 'No decision yet'}
                {f.lastSource ? ` · ${f.lastSource}` : ''}
              </span>
              {f.budgetUsd !== null && (
                <span className="shrink-0" title="Model spend today / daily budget">
                  {fmtMoney(f.spendUsd ?? 0, 2)} / {fmtMoney(f.budgetUsd, 2)}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
