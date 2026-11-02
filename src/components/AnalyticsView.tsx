import { useGameStore } from '../store/gameStore';
import { cx, fmtNum, modelName } from './fmt';

/** A fraction as a percent; '—' when the metric has no data yet. */
const pct = (n: number | null, dp = 1) => (n === null ? '—' : `${(n * 100).toFixed(dp)}%`);
const num = (n: number | null, dp = 2) => (n === null ? '—' : fmtNum(n, dp));
const usd = (n: number | null, dp = 4) => (n === null ? '—' : `$${n.toFixed(dp)}`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">{title}</div>
      {children}
    </div>
  );
}

const TH = 'px-2 py-1 text-left font-normal text-terminal-dim';
const TD = 'px-2 py-1 tabular-nums';

/** ANALYTICS (VISION §11, §13): financial and AI-systems metrics per fund, world conditions, the Director. */
export default function AnalyticsView() {
  const a = useGameStore((s) => s.analytics);
  if (!a) {
    return (
      <Section title="ANALYTICS">
        <div className="p-6 text-center text-[12px] text-terminal-dim">Loading analytics…</div>
      </Section>
    );
  }
  const { events, survival } = a.world;

  return (
    <div className="space-y-3">
      <Section title="FINANCIAL">
        {a.funds.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-terminal-dim">No funds yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr>
                  {['FUND', 'MODEL', 'RETURN', 'MAX DD', 'VOL', 'SHARPE', 'TURNOVER', 'TOP POS', 'HHI', 'SNAPS'].map((h) => (
                    <th key={h} className={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.funds.map((f) => (
                  <tr key={f.id} className="border-t border-terminal-border">
                    <td className={cx(TD, 'font-bold', f.liquidated && 'text-terminal-red line-through')}>{f.name}</td>
                    <td className={cx(TD, 'text-terminal-dim')}>{modelName(f.model)}</td>
                    <td className={cx(TD, f.financial.totalReturn !== null && (f.financial.totalReturn >= 0 ? 'text-terminal-green' : 'text-terminal-red'))}>
                      {pct(f.financial.totalReturn, 2)}
                    </td>
                    <td className={TD}>{pct(f.financial.maxDrawdown)}</td>
                    <td className={TD}>{pct(f.financial.volatility, 2)}</td>
                    <td className={TD}>{num(f.financial.sharpe)}</td>
                    <td className={TD}>{num(f.financial.turnover)}</td>
                    <td className={TD}>{pct(f.financial.largestShare, 0)}</td>
                    <td className={TD}>{num(f.financial.hhi)}</td>
                    <td className={cx(TD, 'text-terminal-dim')}>{f.financial.snapshots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="AI SYSTEMS">
        {a.funds.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-terminal-dim">No funds yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr>
                  {['FUND', 'DECISIONS', 'BY MODEL', 'FALLBACK', 'CALLS', 'FAILED', 'TOKENS IN/OUT', 'COST', '$/DECISION', 'LATENCY', 'TOOLS/CALL'].map((h) => (
                    <th key={h} className={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.funds.map((f) => (
                  <tr key={f.id} className="border-t border-terminal-border">
                    <td className={cx(TD, 'font-bold')}>{f.name}</td>
                    <td className={TD}>{f.ai.decisions}</td>
                    <td className={TD}>{f.ai.llmDecisions}</td>
                    <td className={TD}>{pct(f.ai.fallbackRate, 0)}</td>
                    <td className={TD}>{f.ai.calls}</td>
                    <td className={TD}>{pct(f.ai.failureRate, 0)}</td>
                    <td className={TD}>{f.ai.inputTokens.toLocaleString('en-US')} / {f.ai.outputTokens.toLocaleString('en-US')}</td>
                    <td className={TD}>{usd(f.ai.costUsd, 2)}</td>
                    <td className={TD}>{usd(f.ai.costPerLlmDecision)}</td>
                    <td className={TD}>{f.ai.avgLatencyMs === null ? '—' : `${(f.ai.avgLatencyMs / 1000).toFixed(1)}s`}</td>
                    <td className={TD}>{num(f.ai.toolCallsPerCall, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="WORLD">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[11px]">
            <dt className="text-terminal-dim">SURVIVAL</dt>
            <dd>{survival.alive}/{survival.total} alive ({pct(survival.rate, 0)})</dd>
            <dt className="text-terminal-dim">EVENTS (RECENT)</dt>
            <dd>{events.count}</dd>
            <dt className="text-terminal-dim">BY TYPE</dt>
            <dd>{Object.entries(events.byType).map(([t, n]) => `${t} ${n}`).join(' · ') || '—'}</dd>
            <dt className="text-terminal-dim">TYPE DIVERSITY</dt>
            <dd>{num(events.typeDiversity)}</dd>
            <dt className="text-terminal-dim">MEAN |IMPACT|</dt>
            <dd>{events.meanAbsImpact.toFixed(2)}%</dd>
            <dt className="text-terminal-dim">EXTREME</dt>
            <dd>{events.extremeCount}</dd>
          </dl>
        </Section>
        <Section title="WORLD DIRECTOR">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[11px]">
            <dt className="text-terminal-dim">MODE</dt>
            <dd className="uppercase">{a.director.mode}</dd>
            <dt className="text-terminal-dim">CYCLES</dt>
            <dd>{a.director.cycles}</dd>
            <dt className="text-terminal-dim">INTERVENTIONS</dt>
            <dd>{a.director.applied}</dd>
            <dt className="text-terminal-dim">BY KIND</dt>
            <dd>{Object.entries(a.director.byKind).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}</dd>
          </dl>
        </Section>
      </div>

      <Section title="LIMITATIONS">
        <ul className="list-disc space-y-1 pl-5 text-[11px] text-terminal-dim">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
