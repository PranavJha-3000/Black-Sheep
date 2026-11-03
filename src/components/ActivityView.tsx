import { useGameStore } from '../store/gameStore';
import { cx } from './fmt';
import type { ActivityKind } from '../../server/observerCore';

const KIND_STYLE: Record<ActivityKind, string> = {
  decision: 'bg-terminal-green/10 text-terminal-green',
  call: 'bg-terminal-accent/10 text-terminal-accent',
  tool: 'bg-white/[0.06] text-terminal-soft',
  event: 'bg-terminal-caution/10 text-terminal-caution',
  liquidation: 'bg-terminal-red/10 text-terminal-red',
};

/** ACTIVITY (VISION §13): live decisions, model and tool calls, events and liquidations. */
export default function ActivityView() {
  const activity = useGameStore((s) => s.activity);

  return (
    <div className="panel">
      <div className="label mb-2">Live feed</div>
      {!activity ? (
        <div className="p-6 text-center text-[13px] text-terminal-dim">Loading activity…</div>
      ) : activity.items.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-terminal-dim">Nothing has happened yet.</div>
      ) : (
        <ul className="divide-y divide-terminal-border">
          {activity.items.map((it, i) => (
            <li key={`${it.kind}-${it.at}-${i}`} className="grid grid-cols-[64px_96px_160px_1fr] items-baseline gap-4 py-3 text-[13px]">
              <span className="text-[12px] text-terminal-dim">{it.at.slice(11, 19)}</span>
              <span><span className={cx('rounded-md px-2 py-0.5 text-[11px] font-medium capitalize', KIND_STYLE[it.kind])}>{it.kind}</span></span>
              <span className="truncate font-semibold">{it.fundName ?? 'Market'}</span>
              <span className="min-w-0">
                <span>{it.text}</span>
                {it.detail && <span className="mt-0.5 block truncate text-[12px] text-terminal-dim" title={it.detail}>{it.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
