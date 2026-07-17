import {
  Users,
  ArrowUpCircle,
  RotateCcw,
  HardDrive,
  Timer,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { StatCard, Card, Skeleton, ErrorStrip, RingGauge } from '../components/ui';
import { formatBytes, formatNumber, formatDuration } from '../lib/format';
import type { Overview } from '../types';

const CHECK_LABELS: Record<string, string> = {
  cacheHit: 'Cache hit ≥ 95%',
  noBlocking: 'No blocking sessions',
  noLongQueries: 'No queries > 60s',
  lowDeadTuples: 'Dead tuples < 5%',
};

function tone(ok: boolean, warn?: boolean) {
  return ok ? 'var(--color-ok)' : warn ? 'var(--color-warn)' : 'var(--color-danger)';
}

export function Home() {
  const { data, error, loading } = usePolling<Overview>('/overview', 10_000);

  if (error && !data) return <ErrorStrip message={error} />;

  const score = data?.healthScore ?? 0;
  const cache = data?.cacheHitRatio ?? 0;
  const dead = data?.deadTupleRatio ?? 0;

  return (
    <div className="space-y-6">
      {/* Gauge row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr_1fr]">
        {/* Health score + checks */}
        <Card className="flex items-center gap-5 p-5">
          {loading && !data ? (
            <Skeleton className="h-32 w-32 rounded-full" />
          ) : (
            <RingGauge
              value={score}
              centerLabel={`${score}`}
              sublabel="/ 100"
              color={tone(score >= 80, score >= 50)}
            />
          )}
          <div className="flex-1">
            <div className="mb-2 text-sm font-semibold">Health Score</div>
            <div className="space-y-1.5">
              {data &&
                (Object.keys(CHECK_LABELS) as (keyof Overview['checks'])[]).map((k) => {
                  const c = data.checks[k];
                  return (
                    <div key={k} className="flex items-center justify-between text-sm">
                      <span className="text-muted">{CHECK_LABELS[k]}</span>
                      {c.ok ? (
                        <CheckCircle2 size={16} className="text-[color:var(--color-ok)]" />
                      ) : (
                        <XCircle size={16} className="text-[color:var(--color-danger)]" />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </Card>

        {/* Cache hit gauge */}
        <Card className="flex flex-col items-center justify-center gap-2 p-5">
          {loading && !data ? (
            <Skeleton className="h-32 w-32 rounded-full" />
          ) : (
            <RingGauge
              value={cache}
              centerLabel={`${cache.toFixed(1)}%`}
              color={tone(cache >= 95, cache >= 90)}
            />
          )}
          <div className="text-sm text-muted">Cache hit ratio</div>
        </Card>

        {/* Dead tuple gauge */}
        <Card className="flex flex-col items-center justify-center gap-2 p-5">
          {loading && !data ? (
            <Skeleton className="h-32 w-32 rounded-full" />
          ) : (
            <RingGauge
              value={dead}
              centerLabel={`${dead.toFixed(1)}%`}
              color={tone(dead < 5, dead < 10)}
            />
          )}
          <div className="text-sm text-muted">Dead tuple ratio</div>
        </Card>
      </div>

      {/* Counter cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={<Users size={18} />} label="Active connections" loading={loading} value={data ? formatNumber(data.activeConnections) : undefined} />
        <Metric icon={<HardDrive size={18} />} label="Database size" loading={loading} value={data ? formatBytes(data.databaseSize) : undefined} />
        <Metric icon={<ArrowUpCircle size={18} />} label="Commits" loading={loading} value={data ? formatNumber(data.commits) : undefined} />
        <Metric icon={<RotateCcw size={18} />} label="Rollbacks" loading={loading} value={data ? formatNumber(data.rollbacks) : undefined} />
        <Metric
          icon={<Timer size={18} />}
          label="Longest query"
          loading={loading}
          value={data ? formatDuration(data.longestQuerySeconds) : undefined}
          cardTone={data ? (data.longestQuerySeconds > 60 ? 'danger' : data.longestQuerySeconds > 10 ? 'warn' : undefined) : undefined}
        />
      </div>
    </div>
  );
}

function Metric(props: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  loading: boolean;
  cardTone?: 'ok' | 'warn' | 'danger';
}) {
  if (props.loading && props.value === undefined) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-7 w-20" />
      </Card>
    );
  }
  return <StatCard icon={props.icon} label={props.label} value={props.value ?? '—'} tone={props.cardTone} />;
}
