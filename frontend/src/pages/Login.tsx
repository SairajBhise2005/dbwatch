import { useState, type FormEvent } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { login } from '../lib/api';

interface Props {
  onSuccess: () => void;
}

export function Login({ onSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ok = await login(password);
      if (ok) onSuccess();
      else setError('Incorrect password.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden p-6">
      {/* single decorative accent: a faint mint field glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/3 left-1/2 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full opacity-[0.07] blur-3xl"
        style={{ background: 'radial-gradient(circle, var(--color-brand), transparent 60%)' }}
      />

      <form
        onSubmit={handleSubmit}
        className="rise-in relative w-full max-w-sm rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-8 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-1.5">
          <span className="pulse-dot h-2 w-2 rounded-full bg-[color:var(--color-brand)]" />
          <span className="eyebrow">Secure session</span>
        </div>

        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--color-brand)]">
            <Eye size={22} className="text-[color:var(--color-on-brand)]" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">DBWatch</div>
            <div className="eyebrow mt-0.5">Postgres · RDS Monitor</div>
          </div>
        </div>

        <label htmlFor="pw" className="eyebrow mb-2 block">
          Dashboard password
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[color:var(--color-brand)]">
            ›
          </span>
          <input
            id="pw"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] py-2.5 pl-7 pr-3 font-mono text-sm outline-none transition-colors focus:border-[color:var(--color-brand)]"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="mt-3 font-mono text-xs text-[color:var(--color-danger)]">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--color-brand)] px-4 py-2.5 text-sm font-medium text-[color:var(--color-on-brand)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}
