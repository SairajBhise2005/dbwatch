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
      else setError('Incorrect password');
    } catch {
      setError('Could not reach the server');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-8 shadow-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--color-brand)]">
            <Eye size={20} className="text-[color:var(--color-on-brand)]" />
          </div>
          <div>
            <div className="text-lg font-semibold">DBWatch</div>
            <div className="text-xs text-muted">PostgreSQL Monitoring</div>
          </div>
        </div>

        <label className="mb-1.5 block text-sm text-muted">
          Dashboard password
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[color:var(--color-brand)]"
          placeholder="••••••••"
        />

        {error && (
          <p className="mt-2 text-sm text-[color:var(--color-danger)]">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--color-brand)] px-4 py-2 text-sm font-medium text-[color:var(--color-on-brand)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          Unlock
        </button>
      </form>
    </div>
  );
}
