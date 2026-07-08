import type { ReactNode } from 'react';

// ── Card ──
export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] ${className}`}
    >
      {children}
    </div>
  );
}

// ── Metric card ──
export function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  const toneClass =
    tone === 'ok'
      ? 'text-[color:var(--color-ok)]'
      : tone === 'warn'
        ? 'text-[color:var(--color-warn)]'
        : tone === 'danger'
          ? 'text-[color:var(--color-danger)]'
          : 'text-[color:var(--color-text)]';
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className={`mt-2 truncate text-2xl font-semibold ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

// ── Badge ──
type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  const map: Record<BadgeTone, string> = {
    ok: 'bg-[color:var(--color-ok)]/15 text-[color:var(--color-ok)]',
    warn: 'bg-[color:var(--color-warn)]/15 text-[color:var(--color-warn)]',
    danger: 'bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)]',
    info: 'bg-[color:var(--color-brand)]/15 text-[color:var(--color-brand)]',
    neutral: 'bg-[color:var(--color-surface-2)] text-muted',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

// ── Skeleton (loading placeholder) ──
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[color:var(--color-surface-2)] ${className}`}
    />
  );
}

// ── Inline error strip ──
export function ErrorStrip({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-4 py-3 text-sm">
      <span className="font-medium text-[color:var(--color-danger)]">Error:</span>{' '}
      <span className="text-muted">{message}</span>
    </div>
  );
}
