import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtPct, cx, modelName } from './fmt';

/** FUNDS (VISION §13): every autonomous fund and how it is doing. A row opens FUND DETAIL. */
export default function FundsView() {
  const funds = useGameStore((s) => s.funds);
  const openFund = useGameStore((s) => s.openFund);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">FUNDS ({funds.length})</div>
      {funds.length === 0 ? (
        <div className="p-6 text-center text-[12px] text-terminal-dim">No funds yet — waiting for the world server.</div>
      ) : (
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left text-[10px] text-terminal-dim">
              {['FUND', 'STYLE', 'MODEL', 'NAV', 'RETURN', 'STATUS', 'SPEND / BUDGET', 'LAST DECISION'].map((h) => (
                <th key={h} className="px-2 py-1 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <tr
                key={f.id}
                onClick={() => openFund(f.id)}
                className="cursor-pointer border-t border-terminal-border hover:bg-[#121416]"
              >
                <td className="px-2 py-1.5 font-bold tracking-wider">{f.name}</td>
                <td className="px-2 py-1.5 uppercase text-terminal-dim">{f.personality ?? '—'}</td>
                <td className="px-2 py-1.5 text-terminal-dim">{modelName(f.model)}</td>
                <td className="px-2 py-1.5">{fmtMoney(f.nav)}</td>
                <td className={cx('px-2 py-1.5', f.pnlPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(f.pnlPct)}</td>
                <td className={cx('px-2 py-1.5', f.liquidated ? 'text-terminal-red' : f.thinking ? 'text-terminal-green' : 'text-terminal-dim')}>
                  {f.liquidated ? 'LIQUIDATED' : f.thinking ? 'THINKING' : 'LIVE'}
                </td>
                <td className="px-2 py-1.5 text-terminal-dim">
                  {f.budgetUsd === null ? '—' : `${fmtMoney(f.spendUsd ?? 0, 2)} / ${fmtMoney(f.budgetUsd, 2)}`}
                </td>
                <td className="px-2 py-1.5 text-terminal-dim">
                  {f.lastAction ?? '—'}
                  {f.lastSource ? ` · ${f.lastSource.toUpperCase()}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
