import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * LobbyScreen — create a room or join one via its short shareable code.
 *
 * V1 multiplayer is private rooms sharing a 6-char code (Kahoot/Jackbox
 * model). The code is shown big in the terminal sidebar after creation so
 * the host can read it out.
 */
export default function LobbyScreen() {
  const phase = useGameStore((s) => s.phase);
  const error = useGameStore((s) => s.error);
  const user = useGameStore((s) => s.user);
  const roomCode = useGameStore((s) => s.roomCode);
  const createRoom = useGameStore((s) => s.createRoom);
  const joinRoom = useGameStore((s) => s.joinRoom);
  const logout = useGameStore((s) => s.logout);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (phase !== 'lobby') return null;

  const clean = code.trim().toUpperCase();

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#07090b] font-mono text-terminal-text">
      <div className="w-[420px] rounded border border-terminal-border bg-terminal-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-bold tracking-widest">RAVEN CAPITAL</div>
            <div className="mt-1 text-[10px] tracking-widest text-terminal-dim">
              SESSION: {user?.email ?? '—'}
            </div>
          </div>
          <button
            onClick={logout}
            className="rounded border border-terminal-border px-2 py-1 text-[10px] text-terminal-dim hover:text-terminal-text"
          >
            LOG OUT
          </button>
        </div>

        {roomCode ? (
          <div className="mt-4 rounded border border-terminal-border bg-[#0d0d0d] p-3 text-center">
            <div className="text-[10px] tracking-widest text-terminal-dim">ROOM CODE</div>
            <div className="mt-1 text-3xl font-bold tracking-[0.3em] text-terminal-green">
              {roomCode}
            </div>
          </div>
        ) : null}

        <button
          onClick={() => void run(() => createRoom())}
          disabled={busy}
          className="mt-4 w-full rounded bg-[#00e676] py-2.5 text-[12px] font-bold tracking-widest text-black hover:bg-[#00ff85] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'OPENING DESK…' : 'CREATE ROOM'}
        </button>

        <div className="my-4 flex items-center gap-2 text-[10px] tracking-widest text-terminal-dim">
          <div className="h-px flex-1 bg-terminal-border" />
          <span>OR JOIN VIA CODE</span>
          <div className="h-px flex-1 bg-terminal-border" />
        </div>

        <label className="block text-[11px]">
          <span className="text-terminal-dim">&gt; room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && clean) void run(() => joinRoom(clean));
            }}
            placeholder="K7Q2XA"
            className="mt-1 w-full rounded border border-terminal-border bg-[#0d0d0d] px-2 py-2 text-center text-xl font-bold tracking-[0.3em] text-terminal-text placeholder:text-[#444]"
          />
        </label>

        {error ? <div className="mt-3 text-[11px] text-terminal-red">{error}</div> : null}

        <button
          onClick={() => clean && void run(() => joinRoom(clean))}
          disabled={!clean || busy}
          className="mt-3 w-full rounded border border-terminal-green bg-terminal-green/10 py-2.5 text-[12px] font-bold tracking-widest text-terminal-green hover:bg-terminal-green/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          JOIN ROOM
        </button>

        <div className="mt-3 text-[10px] leading-relaxed text-terminal-dim">
          Share the 6-character code with your desk. 2–4 players per room for V1.
        </div>
      </div>
    </div>
  );
}
