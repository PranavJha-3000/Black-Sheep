import { useGameStore } from '../store/gameStore';
import { cx } from './fmt';
import type { ActivityKind } from '../../server/observerCore';

const KIND_STYLE: Record<ActivityKind, string> = {
  decision: 'text-terminal-green',
  call: 'text-[#8fb3ff]',
  tool: 'text-terminal-dim',
  event: 'text-[#e0c060]',
  liquidation: 'text-terminal-red',
};

/** ACTIVITY (VISION §13): live decisions, model and tool calls, events and liquidations. */
export default function ActivityView() {
  const activity = useGameStore((s) => s.activity);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-[11px] tracking-widest text-terminal-dim">ACTIVITY</div>
      {!activity ? (
        <div className="p-6 text-center text-[12px] text-terminal-dim">Loading activity…</div>
      ) : activity.items.length === 0 ? (
        <div className="p-6 text-center text-[12px] text-terminal-dim">Nothing has happened yet.</div>
      ) : (
        <div className="space-y-1">
          {activity.items.map((it, i) => (
            <div key={`${it.kind}-${it.at}-${i}`} className="grid grid-cols-[72px_88px_150px_1fr] gap-2 border-t border-terminal-border py-1 text-[11px]">
              <span className="text-terminal-dim">{it.at.slice(11, 19)}</span>
              <span className={cx('uppercase tracking-wider', KIND_STYLE[it.kind])}>{it.kind}</span>
              <span className="truncate font-bold">{it.fundName ?? 'MARKET'}</span>
              <span className="min-w-0">
                <span>{it.text}</span>
                {it.detail && <span className="block truncate text-terminal-dim" title={it.detail}>{it.detail}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
