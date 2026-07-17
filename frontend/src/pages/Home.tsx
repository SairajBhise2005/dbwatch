import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, Database, HardDrive, HeartPulse, ArrowUp, ArrowDown,
  Terminal, Archive, Cloud, Activity as ActivityIcon,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { formatBytes, formatNumber, formatAgo } from '../lib/format';
import type { Overview, SessionsResponse, ActivityResponse } from '../types';

interface Pt { time: string; conns: number; txps: number }

const STATE_COLOR: Record<string, string> = {
  active: 'var(--chart-6)',
  idle: 'var(--chart-2)',
  'idle in transaction': 'var(--chart-4)',
};

export function Home() {
  const nav = useNavigate();
  const { data, error, loading } = usePolling<Overview>('/overview', 10_000);
  const { data: sess } = usePolling<SessionsResponse>('/sessions', 10_000);
  const { data: act } = usePolling<ActivityResponse>('/activity', 10_000);

  const [series, setSeries] = useState<Pt[]>([]);
  const [delta, setDelta] = useState<{ conns: number | null; cache: number | null }>({ conns: null, cache: null });
  const prev = useRef<{ commits: number; t: number; conns: number; cache: number } | null>(null);

  // Accumulate a live rolling series + compute deltas from each poll.
  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    let txps = 0;
    if (prev.current) {
      const dt = (now - prev.current.t) / 1000;
      if (dt > 0) txps = Math.max(0, (data.commits - prev.current.commits) / dt);
      setDelta({
        conns: data.activeConnections - prev.current.conns,
        cache: Number((data.cacheHitRatio - prev.current.cache).toFixed(2)),
      });
    }
    const time = new Date(now).toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });
    setSeries((s) => [...s, { time, conns: data.activeConnections, txps: Number(txps.toFixed(1)) }].slice(-24));
    prev.current = { commits: data.commits, t: now, conns: data.activeConnections, cache: data.cacheHitRatio };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error && !data) return <ErrorStrip message={error} />;

  const score = data?.healthScore ?? 0;
  const cache = data?.cacheHitRatio ?? 0;
  const dead = data?.deadTupleRatio ?? 0;

  const byState = sess?.summary.byState ?? {};
  const donut = Object.entries(byState).map(([name, value]) => ({ name, value, color: STATE_COLOR[name] ?? 'var(--chart-1)' }));
  const donutTotal = donut.reduce((a, d) => a + d.value, 0);

  return (
    <div className="space-y-5">
      {/* ── KPI row ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Users size={20} />} color="var(--chart-2)" label="Active connections"
          value={data ? formatNumber(data.activeConnections) : '—'} loading={loading && !data}
          delta={delta.conns} deltaUnit="" />
        <Kpi icon={<Database size={20} />} color="var(--chart-6)" label="Cache hit ratio"
          value={data ? `${cache.toFixed(1)}%` : '—'} loading={loading && !data}
          delta={delta.cache} deltaUnit="%" />
        <Kpi icon={<HardDrive size={20} />} color="var(--chart-4)" label="Database size"
          value={data ? formatBytes(data.databaseSize) : '—'} loading={loading && !data}
          sub="on disk" />
        <Kpi icon={<HeartPulse size={20} />} color="var(--chart-1)" label="Health score"
          value={data ? `${score}` : '—'} loading={loading && !data}
          chip={data ? { text: score >= 80 ? 'Healthy' : score >= 50 ? 'Attention' : 'Critical', tone: score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'danger' } : undefined} />
      </div>

      {/* ── Activity chart + session donut ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Database Activity</h2>
            <div className="flex items-center gap-4 text-xs text-muted">
              <Legend color="var(--chart-1)" label="Connections" />
              <Legend color="var(--chart-2)" label="Txns/sec" />
            </div>
          </div>
          <div className="h-64">
            {series.length < 2 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Collecting live samples…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 8, bottom: 0, left: -14 }}>
                  <defs>
                    <linearGradient id="gConns" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gTxps" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--color-muted)" fontSize={11} minTickGap={40} tickLine={false} />
                  <YAxis stroke="var(--color-muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="conns" name="Connections" stroke="var(--chart-1)" strokeWidth={2} fill="url(#gConns)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="txps" name="Txns/sec" stroke="var(--chart-2)" strokeWidth={2} fill="url(#gTxps)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">Session Breakdown</h2>
          <div className="h-64">
            {donutTotal === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted">
                No active sessions right now.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">
                    {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {donut.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                <span className="text-muted">{d.name}</span>
                <span className="ml-auto font-medium">{d.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Recent activity + quick actions/status ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-[15px] font-semibold">Recent Activity</h2>
          <div className="space-y-1">
            {!act ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : act.activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No recent activity.</p>
            ) : (
              act.activity.slice(0, 6).map((a, i) => {
                const color = a.state === 'active' ? 'var(--chart-6)' : a.state === 'idle in transaction' ? 'var(--chart-4)' : 'var(--chart-2)';
                const verb = (a.query.match(/^\w+/)?.[0] || a.state || 'Query').toUpperCase();
                return (
                  <div key={`${a.pid}-${i}`} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-[color:var(--color-surface-2)]">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
                      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{verb} · {a.username ?? 'system'}</span>
                        <span className="shrink-0 text-xs text-muted">{formatAgo(a.sinceSeconds)}</span>
                      </div>
                      <code className="block truncate font-mono text-xs text-muted">{a.query || '—'}</code>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-3">
              <Action icon={<Terminal size={18} />} label="Run SQL" onClick={() => nav('/sql-editor')} />
              <Action icon={<Archive size={18} />} label="Take Backup" onClick={() => nav('/backups')} />
              <Action icon={<ActivityIcon size={18} />} label="Live Telemetry" onClick={() => nav('/sessions')} />
              <Action icon={<Cloud size={18} />} label="Infra Vitals" onClick={() => nav('/cloud')} />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-[15px] font-semibold">System Status</h2>
            <div className="space-y-2.5">
              <StatusRow label="Database" text={data ? 'Online' : '—'} tone={data ? 'ok' : 'neutral'} />
              <StatusRow label="Cache hit" text={data ? `${cache.toFixed(0)}%` : '—'} tone={cache >= 95 ? 'ok' : cache >= 90 ? 'warn' : 'danger'} />
              <StatusRow label="Blocking" text={data?.blockingSessions ? `${data.blockingSessions}` : 'None'} tone={data?.blockingSessions ? 'danger' : 'ok'} />
              <StatusRow label="Long queries" text={data?.checks.noLongQueries.ok ? 'None' : 'Active'} tone={data?.checks.noLongQueries.ok ? 'ok' : 'danger'} />
              <StatusRow label="Dead tuples" text={data ? `${dead.toFixed(1)}%` : '—'} tone={dead < 5 ? 'ok' : dead < 10 ? 'warn' : 'danger'} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 12,
} as const;

function Kpi({ icon, color, label, value, loading, delta, deltaUnit, sub, chip }: {
  icon: React.ReactNode; color: string; label: string; value: string; loading: boolean;
  delta?: number | null; deltaUnit?: string; sub?: string;
  chip?: { text: string; tone: 'ok' | 'warn' | 'danger' };
}) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: color }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {loading ? <Skeleton className="h-7 w-20" /> : <div className="truncate text-2xl font-bold tracking-tight">{value}</div>}
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-sm text-muted">{label}</span>
          {delta != null && delta !== 0 && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${delta > 0 ? 'text-[color:var(--color-ok)]' : 'text-[color:var(--color-danger)]'}`}>
              {delta > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {Math.abs(delta)}{deltaUnit}
            </span>
          )}
          {sub && <span className="text-xs text-muted">· {sub}</span>}
          {chip && <Badge tone={chip.tone}>{chip.text}</Badge>}
        </div>
      </div>
    </Card>
  );
}

function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-start gap-2 rounded-lg bg-[color:var(--color-surface-2)] p-3 text-sm transition-colors hover:text-[color:var(--color-brand)]">
      <span className="text-[color:var(--color-brand)]">{icon}</span>
      {label}
    </button>
  );
}

function StatusRow({ label, text, tone }: { label: string; text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <Badge tone={tone}>{text}</Badge>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
