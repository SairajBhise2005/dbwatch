import { CheckCircle2, AlertTriangle, Loader2, Lock } from 'lucide-react';
import type { Health } from '../types';

interface Props {
  health: Health | null;
  loading: boolean;
}

// Compact live indicator of DB connectivity, shown in the header.
export function ConnectionBanner({ health, loading }: Props) {
  if (loading && !health) {
    return (
      <Pill className="text-muted">
        <Loader2 size={14} className="animate-spin" />
        Checking connection…
      </Pill>
    );
  }

  const connected = health?.db.connected;

  if (connected) {
    // e.g. "PostgreSQL 18.0 on x86_64…" → keep just the version number.
    const versionShort =
      health?.db.version?.match(/PostgreSQL\s+[\d.]+/)?.[0] ?? 'Connected';
    return (
      <Pill className="text-[color:var(--color-ok)]">
        <CheckCircle2 size={14} />
        {versionShort} · {health?.db.database}
        {health?.tunnel && (
          <span className="ml-1 flex items-center gap-0.5 text-muted" title="Connected via SSH tunnel (bastion)">
            <Lock size={12} /> tunnel
          </span>
        )}
      </Pill>
    );
  }

  return (
    <Pill className="text-[color:var(--color-danger)]">
      <AlertTriangle size={14} />
      Database unreachable
      {health?.db.error ? (
        <span className="text-muted font-normal">— {health.db.error}</span>
      ) : null}
    </Pill>
  );
}

function Pill({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] px-3 py-1.5 text-sm font-medium ${className}`}
    >
      {children}
    </div>
  );
}
