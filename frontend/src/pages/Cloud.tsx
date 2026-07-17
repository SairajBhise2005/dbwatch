import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { Cloud as CloudIcon, Info, Lightbulb, Server } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { Card, Badge, StatCard, Skeleton, ErrorStrip } from '../components/ui';
import { formatBytes } from '../lib/format';
import type {
  CloudOverview,
  CloudMetricsResponse,
  MetricSeries,
  CloudRecommendation,
} from '../types';

const RANGES = [
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
  { label: '24h', minutes: 1440 },
];

const sevTone = { High: 'danger', Medium: 'warn', Low: 'neutral' } as const;

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Cloud() {
  const { data: ov, error, loading } = usePolling<CloudOverview>(
    '/cloud/overview',
    30_000
  );
  const [minutes, setMinutes] = useState(180);
  const { data: mx } = usePolling<CloudMetricsResponse>(
    `/cloud/metrics?minutes=${minutes}`,
    60_000
  );

  if (error && !ov) return <ErrorStrip message={error} />;

  if (ov && !ov.available) {
    return (
      <Card className="flex items-start gap-3 p-5">
        <Info size={20} className="mt-0.5 text-[color:var(--color-warn)]" />
        <div>
          <h2 className="text-sm font-semibold">AWS integration not configured</h2>
          <p className="mt-1 text-sm text-muted">{ov.message}</p>
        </div>
      </Card>
    );
  }

  const inst = ov?.instance;
  const latest = ov?.latest;
  const m = mx?.available ? mx.metrics ?? {} : {};

  return (
    <div className="space-y-6">
      {/* Instance summary */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Server size={16} className="text-[color:var(--color-brand)]" />
          <span className="text-sm font-semibold">
            {ov?.config?.instanceId ?? 'RDS instance'}
          </span>
          {inst?.status && (
            <Badge tone={inst.status === 'available' ? 'ok' : 'warn'}>
              {inst.status}
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted">
            region {ov?.config?.region}
          </span>
        </div>
        {loading && !ov ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4 lg:grid-cols-6">
            <Meta label="Class" value={inst?.instanceClass} />
            <Meta label="Engine" value={`${inst?.engine ?? ''} ${inst?.engineVersion ?? ''}`} />
            <Meta label="Storage" value={`${inst?.allocatedStorageGb ?? '—'} GB ${inst?.storageType ?? ''}`} />
            <Meta label="Multi-AZ" value={inst?.multiAZ ? 'Yes' : 'No'} />
            <Meta label="Backups" value={`${inst?.backupRetentionDays ?? 0} days`} />
            <Meta label="Perf Insights" value={inst?.performanceInsights ? 'On' : 'Off'} />
          </div>
        )}
      </Card>

      {/* Latest snapshot */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-4">
        <StatCard
          label="CPU utilization"
          value={latest?.cpu != null ? `${latest.cpu.toFixed(1)}%` : '—'}
          tone={latest?.cpu != null ? (latest.cpu > 85 ? 'danger' : latest.cpu > 60 ? 'warn' : 'ok') : undefined}
        />
        <StatCard
          label="Connections"
          value={
            latest?.connections != null
              ? `${Math.round(latest.connections)}${ov?.maxConnections ? ` / ${ov.maxConnections}` : ''}`
              : '—'
          }
        />
        <StatCard
          label="Free storage"
          value={latest?.freeStorageBytes != null ? formatBytes(latest.freeStorageBytes) : '—'}
        />
        <StatCard
          label="Freeable memory"
          value={latest?.freeMemoryBytes != null ? formatBytes(latest.freeMemoryBytes) : '—'}
        />
      </div>

      {/* AWS Advisor */}
      {ov?.recommendations && ov.recommendations.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Lightbulb size={16} className="text-[color:var(--color-warn)]" />
            <h2 className="text-sm font-semibold">AWS Advisor</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ov.recommendations.map((r) => (
              <RecCard key={r.id} r={r} />
            ))}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="flex items-center gap-2">
        <CloudIcon size={16} className="text-[color:var(--color-brand)]" />
        <h2 className="text-sm font-semibold">CloudWatch metrics</h2>
        <div className="ml-auto flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.minutes}
              onClick={() => setMinutes(r.minutes)}
              className={`rounded-md px-3 py-1 text-xs ${
                minutes === r.minutes
                  ? 'bg-[color:var(--color-brand)] text-[color:var(--color-on-brand)]'
                  : 'border border-[color:var(--color-border)] text-muted hover:bg-[color:var(--color-surface-2)]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {!mx?.available ? (
        <Card className="flex h-40 items-center justify-center text-sm text-muted">
          {mx?.reason || 'Loading metrics…'}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Chart
            title="CPU utilization (%)"
            data={single(m.cpu)}
            lines={[{ key: 'v', name: 'CPU %', color: 'var(--color-brand)' }]}
          />
          <Chart
            title="Database connections"
            data={single(m.connections)}
            lines={[{ key: 'v', name: 'Connections', color: 'var(--color-ok)' }]}
          />
          <Chart
            title="Free storage (GB)"
            data={single(m.freeStorage, (v) => v / 1024 ** 3)}
            lines={[{ key: 'v', name: 'GB free', color: 'var(--color-warn)' }]}
          />
          <Chart
            title="Freeable memory (MB)"
            data={single(m.freeMemory, (v) => v / 1024 ** 2)}
            lines={[{ key: 'v', name: 'MB free', color: '#a855f7' }]}
          />
          <Chart
            title="IOPS"
            data={dual(m.readIops, m.writeIops)}
            lines={[
              { key: 'a', name: 'Read', color: 'var(--color-brand)' },
              { key: 'b', name: 'Write', color: 'var(--color-danger)' },
            ]}
          />
          <Chart
            title="Latency (ms)"
            data={dual(m.readLatency, m.writeLatency, (v) => v * 1000)}
            lines={[
              { key: 'a', name: 'Read', color: 'var(--color-brand)' },
              { key: 'b', name: 'Write', color: 'var(--color-danger)' },
            ]}
          />
          <Chart
            title="Disk throughput (MB/s)"
            data={dual(m.readThroughput, m.writeThroughput, (v) => v / 1024 ** 2)}
            lines={[
              { key: 'a', name: 'Read', color: 'var(--color-brand)' },
              { key: 'b', name: 'Write', color: 'var(--color-danger)' },
            ]}
          />
          <Chart
            title="Network (MB/s)"
            data={dual(m.netRx, m.netTx, (v) => v / 1024 ** 2)}
            lines={[
              { key: 'a', name: 'In', color: 'var(--color-ok)' },
              { key: 'b', name: 'Out', color: '#a855f7' },
            ]}
          />
          <Chart
            title="Disk queue depth"
            data={single(m.diskQueue)}
            lines={[{ key: 'v', name: 'Queue depth', color: 'var(--color-warn)' }]}
          />
          <Chart
            title="CPU credit balance (t-class)"
            data={single(m.cpuCredits)}
            lines={[{ key: 'v', name: 'Credits', color: 'var(--color-brand)' }]}
          />
        </div>
      )}
    </div>
  );
}

// ── data transforms ──
function single(s?: MetricSeries, map?: (v: number) => number) {
  return (s?.points ?? [])
    .filter((p) => p.v != null)
    .map((p) => ({ time: hhmm(p.t), v: map ? map(p.v as number) : (p.v as number) }));
}
function dual(a?: MetricSeries, b?: MetricSeries, map?: (v: number) => number) {
  const pa = a?.points ?? [];
  const pb = b?.points ?? [];
  const n = Math.max(pa.length, pb.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = pa[i]?.t ?? pb[i]?.t;
    if (!t) continue;
    const av = pa[i]?.v;
    const bv = pb[i]?.v;
    out.push({
      time: hhmm(t),
      a: av == null ? null : map ? map(av) : av,
      b: bv == null ? null : map ? map(bv) : bv,
    });
  }
  return out;
}

function Chart({
  title,
  data,
  lines,
}: {
  title: string;
  data: Record<string, number | string | null>[];
  lines: { key: string; name: string; color: string }[];
}) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="h-52">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            No data in range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="time" stroke="var(--color-muted)" fontSize={10} minTickGap={40} />
              <YAxis stroke="var(--color-muted)" fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {lines.map((l) => (
                <Line
                  key={l.key}
                  type="monotone"
                  dataKey={l.key}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-medium">{value || '—'}</div>
    </div>
  );
}

function RecCard({ r }: { r: CloudRecommendation }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">{r.category}</span>
        <Badge tone={sevTone[r.severity]}>{r.severity}</Badge>
      </div>
      <p className="text-sm text-muted">{r.detail}</p>
      <div className="mt-3 border-t border-[color:var(--color-border)] pt-3 text-sm">
        <span className="font-medium">→ </span>
        {r.recommendation}
      </div>
    </Card>
  );
}
