import { useMemo, useState } from 'react';
import { XCircle, RefreshCw } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatDuration, extractError } from '../lib/format';
import type { Session, SessionsResponse } from '../types';

export function Sessions() {
  const { data, error, loading, reload } = usePolling<SessionsResponse>(
    '/sessions',
    10_000
  );
  const [stateFilter, setStateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<Session | null>(null);
  const [terminating, setTerminating] = useState(false);
  const [actionError, setActionError] = useState('');

  const sessions = data?.sessions ?? [];

  const states = useMemo(
    () => [
      'all',
      ...Array.from(
        new Set(
          sessions
            .map((s) => s.state)
            .filter((s): s is string => Boolean(s))
        )
      ),
    ],
    [sessions]
  );

  const filtered = sessions.filter((s) => {
    if (stateFilter !== 'all' && s.state !== stateFilter) return false;
    if (search) {
      const hay = `${s.username} ${s.database} ${s.query}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  async function confirmTerminate() {
    if (!target) return;
    setTerminating(true);
    setActionError('');
    try {
      await api.delete(`/sessions/${target.pid}`);
      setTarget(null);
      reload();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setTerminating(false);
    }
  }

  // Row highlight rules from the plan.
  function rowTone(s: Session): string {
    if (s.state === 'idle in transaction' && (s.stateSeconds ?? 0) > 30)
      return 'bg-[color:var(--color-danger)]/10';
    if (s.state === 'active' && (s.durationSeconds ?? 0) > 10)
      return 'bg-[color:var(--color-warn)]/10';
    return '';
  }

  return (
    <div className="space-y-4">
      {error && !data && <ErrorStrip message={error} />}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm"
        >
          {states.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All states' : s}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by user, database, or query…"
          className="min-w-[240px] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[color:var(--color-brand)]"
        />
        <span className="text-sm text-muted">
          {filtered.length} of {sessions.length} sessions
        </span>
        <button
          onClick={reload}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>

      {actionError && <ErrorStrip message={actionError} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <Th>PID</Th>
                <Th>User</Th>
                <Th>Database</Th>
                <Th>State</Th>
                <Th>Duration</Th>
                <Th>Wait</Th>
                <Th>Query</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--color-border)]">
                      <td colSpan={8} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : filtered.map((s) => (
                    <tr
                      key={s.pid}
                      className={`border-b border-[color:var(--color-border)] ${rowTone(s)}`}
                    >
                      <Td>{s.pid}</Td>
                      <Td>{s.username ?? '—'}</Td>
                      <Td>{s.database ?? '—'}</Td>
                      <Td>
                        <StateBadge state={s.state} />
                      </Td>
                      <Td>{formatDuration(s.durationSeconds)}</Td>
                      <Td>
                        {s.waitEvent ? (
                          <span className="text-muted">
                            {s.waitType}: {s.waitEvent}
                          </span>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <td className="max-w-[340px] px-4 py-2.5">
                        <code className="block truncate font-mono text-xs text-muted" title={s.query}>
                          {s.query || '—'}
                        </code>
                      </td>
                      <Td>
                        <button
                          onClick={() => setTarget(s)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10"
                        >
                          <XCircle size={14} />
                          Kill
                        </button>
                      </Td>
                    </tr>
                  ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    No sessions match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmModal
        open={!!target}
        title="Terminate backend?"
        busy={terminating}
        confirmLabel="Terminate"
        onCancel={() => setTarget(null)}
        onConfirm={confirmTerminate}
        body={
          <>
            This calls <code>pg_terminate_backend({target?.pid})</code> and will
            forcibly end the connection for user{' '}
            <span className="font-medium">{target?.username}</span>. Any
            in-flight transaction is rolled back.
          </>
        }
      />
    </div>
  );
}

function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span>—</span>;
  const tone =
    state === 'active'
      ? 'info'
      : state === 'idle'
        ? 'neutral'
        : state === 'idle in transaction'
          ? 'warn'
          : 'neutral';
  return <Badge tone={tone}>{state}</Badge>;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5">{children}</td>;
}
