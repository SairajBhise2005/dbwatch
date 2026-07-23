import { useState } from 'react';
import { RefreshCw, RotateCcw, Info } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { TimeRangePicker } from '../components/TimeRangePicker';
import { formatNumber, extractError } from '../lib/format';
import type { QueryPerformanceResponse, QueryStat } from '../types';

type SortKey = 'totalTime' | 'meanTime' | 'calls';

const PRESETS = [
  { label: 'Since reset', minutes: 0 },
  { label: 'Last 15 minutes', minutes: 15 },
  { label: 'Last 30 minutes', minutes: 30 },
  { label: 'Last 1 hour', minutes: 60 },
  { label: 'Last 6 hours', minutes: 360 },
];

export function QueryPerformance() {
  const [minutes, setMinutes] = useState(0);
  const [refreshMs, setRefreshMs] = useState(15_000);
  const { data, error, loading, reload } = usePolling<QueryPerformanceResponse>(
    `/query-performance${minutes ? `?minutes=${minutes}` : ''}`,
    refreshMs
  );
  const [sortKey, setSortKey] = useState<SortKey>('totalTime');
  const [search, setSearch] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionError, setActionError] = useState('');

  const statements = data?.statements ?? [];
  const filtered = statements
    .filter((s) =>
      search ? s.query.toLowerCase().includes(search.toLowerCase()) : true
    )
    .sort((a, b) => b[sortKey] - a[sortKey]);

  async function doReset() {
    setResetting(true);
    setActionError('');
    try {
      await api.post('/query-performance/reset');
      setConfirmReset(false);
      reload();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setResetting(false);
    }
  }

  if (error && !data) return <ErrorStrip message={error} />;

  if (data && !data.available) {
    return (
      <Card className="flex items-start gap-3 p-5">
        <Info size={20} className="mt-0.5 text-[color:var(--color-warn)]" />
        <div>
          <h2 className="text-sm font-semibold">pg_stat_statements not enabled</h2>
          <p className="mt-1 text-sm text-muted">{data.message}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">Window</label>
        <TimeRangePicker
          value={minutes}
          onChange={setMinutes}
          presets={PRESETS}
          zeroLabel="Since reset"
          refreshMs={refreshMs}
          onRefreshChange={setRefreshMs}
        />
        {data?.windowed && (
          <Badge tone="info">last ~{data.windowMinutes}m</Badge>
        )}
        {data?.collecting && (
          <span className="text-xs text-[color:var(--color-warn)]">collecting history…</span>
        )}
        <label className="text-sm text-muted">Sort by</label>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm"
        >
          <option value="totalTime">Total time</option>
          <option value="meanTime">Mean time</option>
          <option value="calls">Calls</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search query text…"
          className="min-w-[240px] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[color:var(--color-brand)]"
        />
        <span className="text-sm text-muted">{filtered.length} queries</span>
        <button
          onClick={reload}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
        <button
          onClick={() => setConfirmReset(true)}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--color-warn)]/50 px-3 py-2 text-sm text-[color:var(--color-warn)] hover:bg-[color:var(--color-warn)]/10"
        >
          <RotateCcw size={15} />
          Reset stats
        </button>
      </div>

      {actionError && <ErrorStrip message={actionError} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Query</th>
                <th className="px-4 py-2.5 text-right font-medium">Calls</th>
                <th className="px-4 py-2.5 text-right font-medium">Total (ms)</th>
                <th className="px-4 py-2.5 text-right font-medium">Mean (ms)</th>
                <th className="px-4 py-2.5 text-right font-medium">Rows</th>
                <th className="px-4 py-2.5 text-right font-medium">Stddev</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--color-border)]">
                      <td colSpan={6} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : filtered.map((s, i) => <Row key={s.queryid ?? i} s={s} />)}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    No query statistics yet. Run some queries, then refresh.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmModal
        open={confirmReset}
        title="Reset query statistics?"
        busy={resetting}
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={doReset}
        body={
          <>
            This calls <code>pg_stat_statements_reset()</code> and clears all
            accumulated query statistics. Historical timing data will be lost.
          </>
        }
      />
    </div>
  );
}

function Row({ s }: { s: QueryStat }) {
  const slow = s.meanTime > 1000; // > 1s mean
  return (
    <tr className="border-b border-[color:var(--color-border)] align-top">
      <td className="max-w-[440px] px-4 py-2.5">
        <code className="block truncate font-mono text-xs text-muted" title={s.query}>
          {s.query || '—'}
        </code>
        {slow && (
          <span className="mt-1 inline-block">
            <Badge tone="danger">slow · {(s.meanTime / 1000).toFixed(2)}s mean</Badge>
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.calls)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(Math.round(s.totalTime))}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{s.meanTime.toFixed(2)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(s.rows)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums">{s.stddevTime.toFixed(2)}</td>
    </tr>
  );
}
