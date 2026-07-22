import { useMemo, useState } from 'react';
import { XCircle, RefreshCw, CheckCircle2, AlertTriangle, Users, Network, Activity, Lock as LockIcon, Sparkles, Loader2 } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Badge, StatCard, Skeleton, ErrorStrip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatDuration, extractError } from '../lib/format';
import type { Session, SessionsResponse, Diagnostics, DiagStatus, LocksResponse, AiDiagnoseResult } from '../types';

export function Sessions() {
  const { data, error, loading, reload } = usePolling<SessionsResponse>(
    '/sessions',
    10_000
  );
  const { data: diag } = usePolling<Diagnostics>('/diagnostics', 15_000);
  const { data: locks } = usePolling<LocksResponse>('/locks', 10_000);
  const [aiBusy, setAiBusy] = useState(false);
  const [advice, setAdvice] = useState<AiDiagnoseResult | null>(null);

  async function getAdvice() {
    if (!diag) return;
    setAiBusy(true);
    setAdvice(null);
    try {
      const { data } = await api.post<AiDiagnoseResult>('/ai/diagnose', { diagnostics: diag });
      setAdvice(data);
    } catch (e) {
      setAdvice({ available: false, reason: extractError(e) });
    } finally {
      setAiBusy(false);
    }
  }
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

  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {error && !data && <ErrorStrip message={error} />}

      {/* Connection metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={<Network size={18} />} label="Total connections" value={summary ? String(summary.totalConnections) : '…'} />
        <StatCard icon={<Users size={18} />} label="Distinct users" value={summary ? String(summary.distinctUsers) : '…'} />
        <StatCard icon={<Activity size={18} />} label="Active" value={summary ? String(summary.active) : '…'} tone={summary && summary.active > 0 ? 'ok' : undefined} />
        <StatCard
          icon={<AlertTriangle size={18} />}
          label="Idle in transaction"
          value={summary ? String(summary.idleInTransaction) : '…'}
          tone={summary && summary.idleInTransaction > 0 ? 'warn' : undefined}
        />
      </div>

      {/* Automated health diagnostics */}
      {diag && (
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Automated health diagnostics</h2>
            <Badge tone={diag.overall === 'ok' ? 'ok' : diag.overall === 'warn' ? 'warn' : 'danger'}>
              {diag.overall === 'ok' ? 'Healthy' : diag.overall === 'warn' ? 'Attention' : 'Critical'}
            </Badge>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted">
                {diag.summary.ok} ok · {diag.summary.warn} warn · {diag.summary.fail} fail
              </span>
              <button
                onClick={getAdvice}
                disabled={aiBusy}
                className="flex items-center gap-1.5 rounded-lg border border-[color:var(--color-border)] px-2.5 py-1 text-xs hover:bg-[color:var(--color-surface-2)] disabled:opacity-50"
              >
                {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} className="text-[color:var(--color-brand)]" />}
                AI advice
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
            {diag.checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2 text-sm">
                <DiagIcon status={c.status} />
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {advice && (
            <div className="mt-4 border-t border-[color:var(--color-border)] pt-3">
              {!advice.available ? (
                <p className="text-sm text-muted">
                  AI unavailable{advice.reason ? `: ${advice.reason}` : ''}.
                </p>
              ) : advice.raw ? (
                <pre className="whitespace-pre-wrap text-sm text-muted">{advice.raw}</pre>
              ) : (
                <div className="space-y-2 text-sm">
                  {advice.summary && <p className="text-muted">{advice.summary}</p>}
                  {advice.actions?.map((a, i) => (
                    <div key={i}>
                      <span className="font-medium">→ {a.title}</span>
                      <span className="text-muted"> — {a.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Active locks */}
      {locks && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-2.5">
            <LockIcon size={15} className="text-muted" />
            <h2 className="text-sm font-semibold">Active Locks</h2>
            <span className="ml-auto text-xs text-muted">
              {locks.total} held ·{' '}
              <span className={locks.waiting ? 'text-[color:var(--color-warn)]' : ''}>{locks.waiting} waiting</span> ·{' '}
              <span className={locks.blocked ? 'text-[color:var(--color-danger)]' : ''}>{locks.blocked} blocked</span>
            </span>
          </div>
          {locks.locks.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No active locks.</p>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">PID</th>
                    <th className="px-4 py-2 font-medium">User</th>
                    <th className="px-4 py-2 font-medium">Object</th>
                    <th className="px-4 py-2 font-medium">Mode</th>
                    <th className="px-4 py-2 font-medium">Granted</th>
                    <th className="px-4 py-2 font-medium">Blocked by</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.locks.map((l, i) => (
                    <tr
                      key={`${l.pid}-${i}`}
                      className={`border-b border-[color:var(--color-border)] ${l.blockedBy.length ? 'bg-[color:var(--color-danger)]/10' : !l.granted ? 'bg-[color:var(--color-warn)]/10' : ''}`}
                    >
                      <td className="px-4 py-2 tabular-nums">{l.pid}</td>
                      <td className="px-4 py-2">{l.username ?? '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs">{l.relation ?? l.locktype}</td>
                      <td className="px-4 py-2 text-xs text-muted">{l.mode}</td>
                      <td className="px-4 py-2">
                        {l.granted ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">waiting</Badge>}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-xs">
                        {l.blockedBy.length ? l.blockedBy.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

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

function DiagIcon({ status }: { status: DiagStatus }) {
  if (status === 'ok') return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[color:var(--color-ok)]" />;
  if (status === 'warn') return <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[color:var(--color-warn)]" />;
  return <XCircle size={16} className="mt-0.5 shrink-0 text-[color:var(--color-danger)]" />;
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5">{children}</td>;
}
