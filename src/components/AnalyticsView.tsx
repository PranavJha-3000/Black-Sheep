import { useGameStore } from '../store/gameStore';
import { cx, fmtNum, modelName } from './fmt';

/** A fraction as a percent; '—' when the metric has no data yet. */
const pct = (n: number | null, dp = 1) => (n === null ? '—' : `${(n * 100).toFixed(dp)}%`);
const num = (n: number | null, dp = 2) => (n === null ? '—' : fmtNum(n, dp));
const usd = (n: number | null, dp = 4) => (n === null ? '—' : `$${n.toFixed(dp)}`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <div className="label mb-4">{title}</div>
      {children}
    </div>
  );
}


/** ANALYTICS (VISION §11, §13): financial and AI-systems metrics per fund, world conditions, the Director. */
export default function AnalyticsView() {
  const a = useGameStore((s) => s.analytics);
  if (!a) {
    return (
      <Section title="Analytics">
        <div className="p-6 text-center text-[13px] text-terminal-dim">Loading analytics…</div>
      </Section>
    );
  }
  const { events, survival } = a.world;

  return (
    <div className="space-y-6">
      <Section title="Financial">
        {a.funds.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-terminal-dim">No funds yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-[13px]">
              <thead>
                <tr>
                  {['Fund', 'Model', 'Return', 'Max DD', 'Vol', 'Sharpe', 'Turnover', 'Top pos', 'HHI', 'Snaps'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.funds.map((f) => (
                  <tr key={f.id} className="border-t border-terminal-border">
                    <td className={cx('font-semibold', f.liquidated && 'text-terminal-red line-through')}>{f.name}</td>
                    <td className={cx('text-terminal-dim')}>{modelName(f.model)}</td>
                    <td className={cx(f.financial.totalReturn !== null && (f.financial.totalReturn >= 0 ? 'text-terminal-green' : 'text-terminal-red'))}>
                      {pct(f.financial.totalReturn, 2)}
                    </td>
                    <td>{pct(f.financial.maxDrawdown)}</td>
                    <td>{pct(f.financial.volatility, 2)}</td>
                    <td>{num(f.financial.sharpe)}</td>
                    <td>{num(f.financial.turnover)}</td>
                    <td>{pct(f.financial.largestShare, 0)}</td>
                    <td>{num(f.financial.hhi)}</td>
                    <td className={cx('text-terminal-dim')}>{f.financial.snapshots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="AI systems">
        {a.funds.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-terminal-dim">No funds yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-[13px]">
              <thead>
                <tr>
                  {['Fund', 'Decisions', 'By model', 'Fallback', 'Calls', 'Failed', 'Tokens in/out', 'Cost', '$/decision', 'Latency', 'Tools/call'].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.funds.map((f) => (
                  <tr key={f.id} className="border-t border-terminal-border">
                    <td className={cx('font-semibold')}>{f.name}</td>
                    <td>{f.ai.decisions}</td>
                    <td>{f.ai.llmDecisions}</td>
                    <td>{pct(f.ai.fallbackRate, 0)}</td>
                    <td>{f.ai.calls}</td>
                    <td>{pct(f.ai.failureRate, 0)}</td>
                    <td>{f.ai.inputTokens.toLocaleString('en-US')} / {f.ai.outputTokens.toLocaleString('en-US')}</td>
                    <td>{usd(f.ai.costUsd, 2)}</td>
                    <td>{usd(f.ai.costPerLlmDecision)}</td>
                    <td>{f.ai.avgLatencyMs === null ? '—' : `${(f.ai.avgLatencyMs / 1000).toFixed(1)}s`}</td>
                    <td>{num(f.ai.toolCallsPerCall, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="World">
          <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-[13px]">
            <dt className="text-terminal-dim">Survival</dt>
            <dd>{survival.alive}/{survival.total} alive ({pct(survival.rate, 0)})</dd>
            <dt className="text-terminal-dim">Events (recent)</dt>
            <dd>{events.count}</dd>
            <dt className="text-terminal-dim">By type</dt>
            <dd>{Object.entries(events.byType).map(([t, n]) => `${t} ${n}`).join(' · ') || '—'}</dd>
            <dt className="text-terminal-dim">Type diversity</dt>
            <dd>{num(events.typeDiversity)}</dd>
            <dt className="text-terminal-dim">Mean |impact|</dt>
            <dd>{events.meanAbsImpact.toFixed(2)}%</dd>
            <dt className="text-terminal-dim">Extreme</dt>
            <dd>{events.extremeCount}</dd>
          </dl>
        </Section>
        <Section title="World Director">
          <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-[13px]">
            <dt className="text-terminal-dim">Mode</dt>
            <dd className="capitalize">{a.director.mode}</dd>
            <dt className="text-terminal-dim">Cycles</dt>
            <dd>{a.director.cycles}</dd>
            <dt className="text-terminal-dim">Interventions</dt>
            <dd>{a.director.applied}</dd>
            <dt className="text-terminal-dim">By kind</dt>
            <dd>{Object.entries(a.director.byKind).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}</dd>
          </dl>
        </Section>
      </div>

      <Section title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-terminal-dim">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
