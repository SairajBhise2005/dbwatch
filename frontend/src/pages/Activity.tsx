import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { formatAgo, formatDuration } from '../lib/format';
import type { ActivityResponse, Activity as ActivityRow } from '../types';

const WINDOWS = [
  { label: 'All', minutes: 0 },
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
];

// Recent Query Activity — the practical alternative to live log-file
// reading, built from pg_stat_activity ordered by state_change.
export function Activity() {
  const [minutes, setMinutes] = useState(0);
  const { data, error, loading, reload } = usePolling<ActivityResponse>(
    `/activity${minutes ? `?minutes=${minutes}` : ''}`,
    5_000
  );

  if (error && !data) return <ErrorStrip message={error} />;

  const rows = data?.activity ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">Last change within</span>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.minutes}
              onClick={() => setMinutes(w.minutes)}
              className={`rounded-md px-3 py-1 text-xs ${
                minutes === w.minutes
                  ? 'bg-[color:var(--color-brand)] text-[color:var(--color-on-brand)]'
                  : 'border border-[color:var(--color-border)] text-muted hover:bg-[color:var(--color-surface-2)]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">· {rows.length} entries</span>
        <button
          onClick={reload}
          className="ml-auto flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Last change</th>
                <th className="px-4 py-2.5 font-medium">PID</th>
                <th className="px-4 py-2.5 font-medium">User</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">Query</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--color-border)]">
                      <td colSpan={5} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : rows.map((r, i) => <Row key={`${r.pid}-${i}`} r={r} />)}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No recent activity.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Row({ r }: { r: ActivityRow }) {
  const tone =
    r.state === 'active'
      ? 'info'
      : r.state === 'idle in transaction'
        ? 'warn'
        : 'neutral';
  return (
    <tr className="border-b border-[color:var(--color-border)]">
      <td className="whitespace-nowrap px-4 py-2.5 text-muted">
        {formatAgo(r.sinceSeconds)}
      </td>
      <td className="px-4 py-2.5 tabular-nums">{r.pid}</td>
      <td className="px-4 py-2.5">{r.username ?? '—'}</td>
      <td className="px-4 py-2.5">
        {r.state ? <Badge tone={tone}>{r.state}</Badge> : '—'}
        {r.state === 'active' && r.durationSeconds != null && (
          <span className="ml-2 text-xs text-muted">
            {formatDuration(r.durationSeconds)}
          </span>
        )}
      </td>
      <td className="max-w-[460px] px-4 py-2.5">
        <code className="block truncate font-mono text-xs text-muted" title={r.query}>
          {r.query || '—'}
        </code>
      </td>
    </tr>
  );
}
