import { useState } from 'react';
import { useGameStore } from '../store/gameStore';

/**
 * AuthScreen — the terminal login prompt.
 *
 * Minimal by design: email + password, monospace, boot-sequence vibes.
 * Not a SaaS form — it should feel like keying into a trading terminal.
 */
export default function AuthScreen() {
  const phase = useGameStore((s) => s.phase);
  const error = useGameStore((s) => s.error);
  const register = useGameStore((s) => s.register);
  const login = useGameStore((s) => s.login);
  const clearError = useGameStore((s) => s.clearError);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (phase !== 'auth') return null;

  const valid = email.includes('@') && password.length >= 6;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#07090b] font-mono text-terminal-text">
      <div className="w-[380px] rounded border border-terminal-border bg-terminal-panel p-5">
        <div className="text-[13px] font-bold tracking-widest">RAVEN CAPITAL</div>
        <div className="mt-1 text-[10px] tracking-widest text-terminal-dim">
          SECURE TERMINAL ACCESS — V1
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setMode('login');
              clearError();
            }}
            className={
              mode === 'login'
                ? 'rounded border border-terminal-green bg-terminal-green/10 px-2 py-1.5 text-[11px] font-bold text-terminal-green'
                : 'rounded border border-terminal-border px-2 py-1.5 text-[11px] text-terminal-dim'
            }
          >
            LOG IN
          </button>
          <button
            onClick={() => {
              setMode('signup');
              clearError();
            }}
            className={
              mode === 'signup'
                ? 'rounded border border-terminal-green bg-terminal-green/10 px-2 py-1.5 text-[11px] font-bold text-terminal-green'
                : 'rounded border border-terminal-border px-2 py-1.5 text-[11px] text-terminal-dim'
            }
          >
            SIGN UP
          </button>
        </div>

        <label className="mt-4 block text-[11px]">
          <span className="text-terminal-dim">&gt; email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            type="email"
            autoComplete="email"
            placeholder="trader@ravencapital.com"
            className="mt-1 w-full rounded border border-terminal-border bg-[#0d0d0d] px-2 py-2 text-terminal-text placeholder:text-[#444]"
          />
        </label>

        <label className="mt-3 block text-[11px]">
          <span className="text-terminal-dim">&gt; password (min 6 chars)</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            placeholder="••••••••"
            className="mt-1 w-full rounded border border-terminal-border bg-[#0d0d0d] px-2 py-2 text-terminal-text placeholder:text-[#444]"
          />
        </label>

        {error ? <div className="mt-3 text-[11px] text-terminal-red">{error}</div> : null}

        <button
          onClick={() => void submit()}
          disabled={!valid || busy}
          className="mt-4 w-full rounded bg-[#00e676] py-2.5 text-[12px] font-bold tracking-widest text-black hover:bg-[#00ff85] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'AUTHENTICATING…' : mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT'}
        </button>

        <div className="mt-3 text-[10px] leading-relaxed text-terminal-dim">
          DISCIPLINE COMPOUNDS. Your session persists locally — reopen the tab and
          you resume where the market left you.
        </div>
      </div>
    </div>
  );
}
