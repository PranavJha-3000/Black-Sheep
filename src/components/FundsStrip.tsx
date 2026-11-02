import { useGameStore } from '../store/gameStore';
import { MODEL_REGISTRY } from '../../config/models';
import { fmtMoney, fmtPct, cx } from './fmt';

/**
 * FundsStrip - every AI fund in the world at a glance: name, model, NAV,
 * return and status. The rest of the terminal still focuses one fund; this
 * strip is what makes the others visible until the full FUNDS view (Stage 6).
 */
export default function FundsStrip() {
  const funds = useGameStore((s) => s.funds);
  if (funds.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {funds.map((f) => {
        const model = f.model ? (MODEL_REGISTRY[f.model as keyof typeof MODEL_REGISTRY]?.displayName ?? f.model) : 'UNREGISTERED';
        const status = f.liquidated ? 'LIQUIDATED' : f.thinking ? 'THINKING' : 'LIVE';
        return (
          <div key={f.id} className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="flex items-center justify-between">
              <span className="truncate text-[11px] font-bold tracking-widest">{f.name}</span>
              <span
                className={cx(
                  'text-[9px] tracking-widest',
                  f.liquidated ? 'text-terminal-red' : f.thinking ? 'text-terminal-green' : 'text-terminal-dim',
                )}
              >
                {status}
              </span>
            </div>
            <div className="text-[9px] uppercase tracking-widest text-terminal-dim">
              {f.personality ?? '—'} · {model}
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-[13px]">{fmtMoney(f.nav)}</span>
              <span className={cx('text-[11px]', f.pnlPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>
                {fmtPct(f.pnlPct)}
              </span>
            </div>
            <div className="flex justify-between gap-2 text-[9px] text-terminal-dim">
              <span className="truncate">
                {f.lastAction ?? 'NO DECISION YET'}
                {f.lastSource ? ` · ${f.lastSource.toUpperCase()}` : ''}
              </span>
              {f.budgetUsd !== null && (
                <span className="shrink-0" title="Model spend today / daily budget">
                  {fmtMoney(f.spendUsd ?? 0, 2)} / {fmtMoney(f.budgetUsd, 2)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
