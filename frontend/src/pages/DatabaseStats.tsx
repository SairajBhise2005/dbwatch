import { useEffect, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { usePolling } from '../hooks/usePolling';
import { Card, StatCard, ErrorStrip } from '../components/ui';
import { formatNumber, formatBytes } from '../lib/format';
import type { DatabaseStats as Stats } from '../types';

interface Point {
  time: string;
  ratio: number;
}

export function DatabaseStats() {
  const { data, error, loading } = usePolling<Stats>('/database-stats', 10_000);
  const [series, setSeries] = useState<Point[]>([]);
  const lastRatio = useRef<number | null>(null);

  // Accumulate cache-hit ratio samples in-session (no persistence).
  useEffect(() => {
    if (!data) return;
    if (lastRatio.current === data.cacheHitRatio && series.length > 0) {
      // still record time progression even if ratio unchanged
    }
    lastRatio.current = data.cacheHitRatio;
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      minute: '2-digit',
      second: '2-digit',
    });
    setSeries((prev) => [...prev, { time, ratio: data.cacheHitRatio }].slice(-30));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error && !data) return <ErrorStrip message={error} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Commits" value={data ? formatNumber(data.commits) : '…'} />
        <StatCard label="Rollbacks" value={data ? formatNumber(data.rollbacks) : '…'} />
        <StatCard label="Blocks hit (cache)" value={data ? formatNumber(data.blocksHit) : '…'} />
        <StatCard label="Blocks read (disk)" value={data ? formatNumber(data.blocksRead) : '…'} />
        <StatCard label="Rows returned" value={data ? formatNumber(data.rowsReturned) : '…'} />
        <StatCard label="Rows fetched" value={data ? formatNumber(data.rowsFetched) : '…'} />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Cache Hit Ratio (live)</h2>
          <span
            className="text-2xl font-bold"
            style={{
              color:
                (data?.cacheHitRatio ?? 100) >= 95
                  ? 'var(--color-ok)'
                  : (data?.cacheHitRatio ?? 100) >= 90
                    ? 'var(--color-warn)'
                    : 'var(--color-danger)',
            }}
          >
            {data ? `${data.cacheHitRatio}%` : '—'}
          </span>
        </div>
        <div className="h-64">
          {series.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              {loading ? 'Collecting samples…' : 'Waiting for data…'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="time" stroke="var(--color-muted)" fontSize={11} />
                <YAxis
                  domain={[
                    (min: number) => Math.max(0, Math.floor(min - 2)),
                    100,
                  ]}
                  stroke="var(--color-muted)"
                  fontSize={11}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-2)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--color-muted)' }}
                />
                <Line
                  type="monotone"
                  dataKey="ratio"
                  stroke="var(--color-brand)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="Cache hit %"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Rows inserted" value={data ? formatNumber(data.rowsInserted) : '…'} />
        <StatCard label="Rows updated" value={data ? formatNumber(data.rowsUpdated) : '…'} />
        <StatCard label="Rows deleted" value={data ? formatNumber(data.rowsDeleted) : '…'} />
        <StatCard
          label="Deadlocks"
          value={data ? formatNumber(data.deadlocks) : '…'}
          tone={data && data.deadlocks > 0 ? 'danger' : undefined}
        />
        <StatCard label="Temp files" value={data ? formatNumber(data.tempFiles) : '…'} />
        <StatCard label="Temp bytes" value={data ? formatBytes(data.tempBytes) : '…'} />
      </div>
    </div>
  );
}
