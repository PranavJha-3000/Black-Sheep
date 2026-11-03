import { useGameStore } from '../store/gameStore';
import { fmtMoney, fmtPct, cx, modelName } from './fmt';

/** FUNDS (VISION §13): every autonomous fund and how it is doing. A row opens FUND DETAIL. */
export default function FundsView() {
  const funds = useGameStore((s) => s.funds);
  const openFund = useGameStore((s) => s.openFund);

  return (
    <div className="panel">
      <div className="label mb-4">{funds.length} funds</div>
      {funds.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-terminal-dim">No funds yet — waiting for the world server.</div>
      ) : (
        <table className="data-table w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {['Fund', 'Style', 'Model', 'NAV', 'Return', 'Status', 'Spend / budget', 'Last decision'].map((h) => (
                <th key={h} className={h === 'NAV' || h === 'Return' ? '!text-right' : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <tr key={f.id} onClick={() => openFund(f.id)} className="cursor-pointer hover:bg-white/[0.03]">
                <td className="font-semibold">
                  {/* The row is clickable for the mouse; this button is the keyboard and screen-reader path. */}
                  <button type="button" onClick={() => openFund(f.id)} className="text-left hover:text-terminal-accent">
                    {f.name}
                  </button>
                </td>
                <td className="capitalize text-terminal-dim">{f.personality ?? '—'}</td>
                <td className="text-terminal-dim">{modelName(f.model)}</td>
                <td className="text-right">{fmtMoney(f.nav)}</td>
                <td className={cx('text-right font-medium', f.pnlPct >= 0 ? 'text-terminal-green' : 'text-terminal-red')}>{fmtPct(f.pnlPct)}</td>
                <td className={cx(f.liquidated ? 'text-terminal-red' : f.thinking ? 'text-terminal-accent' : 'text-terminal-dim')}>
                  {f.liquidated ? 'Liquidated' : f.thinking ? 'Thinking' : 'Live'}
                </td>
                <td className="text-terminal-dim">
                  {f.budgetUsd === null ? '—' : `${fmtMoney(f.spendUsd ?? 0, 2)} / ${fmtMoney(f.budgetUsd, 2)}`}
                </td>
                <td className="text-terminal-dim">
                  {f.lastAction ?? '—'}
                  {f.lastSource ? ` · ${f.lastSource}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
