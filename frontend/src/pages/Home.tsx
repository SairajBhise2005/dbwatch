import {
  Users,
  Database,
  ArrowUpCircle,
  RotateCcw,
  HardDrive,
  Timer,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { StatCard, Card, Skeleton, ErrorStrip } from '../components/ui';
import { formatBytes, formatNumber, formatDuration } from '../lib/format';
import type { Overview } from '../types';

// Overview — single-glance health dashboard. Auto-refreshes every 10s.
export function Home() {
  const { data, error, loading } = usePolling<Overview>('/overview', 10_000);

  if (error && !data) return <ErrorStrip message={error} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <HealthScore data={data} loading={loading} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Metric
            icon={<Users size={18} />}
            label="Active connections"
            loading={loading}
            value={data ? formatNumber(data.activeConnections) : undefined}
          />
          <Metric
            icon={<Database size={18} />}
            label="Cache hit ratio"
            loading={loading}
            value={data ? `${data.cacheHitRatio}%` : undefined}
            tone={
              data
                ? data.cacheHitRatio >= 95
                  ? 'ok'
                  : data.cacheHitRatio >= 90
                    ? 'warn'
                    : 'danger'
                : undefined
            }
          />
          <Metric
            icon={<HardDrive size={18} />}
            label="Database size"
            loading={loading}
            value={data ? formatBytes(data.databaseSize) : undefined}
          />
          <Metric
            icon={<ArrowUpCircle size={18} />}
            label="Commits"
            loading={loading}
            value={data ? formatNumber(data.commits) : undefined}
          />
          <Metric
            icon={<RotateCcw size={18} />}
            label="Rollbacks"
            loading={loading}
            value={data ? formatNumber(data.rollbacks) : undefined}
          />
          <Metric
            icon={<Timer size={18} />}
            label="Longest query"
            loading={loading}
            value={data ? formatDuration(data.longestQuerySeconds) : undefined}
            tone={
              data
                ? data.longestQuerySeconds > 60
                  ? 'danger'
                  : data.longestQuerySeconds > 10
                    ? 'warn'
                    : undefined
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

function Metric(props: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  loading: boolean;
  tone?: 'ok' | 'warn' | 'danger';
}) {
  if (props.loading && props.value === undefined) {
    return (
      <Card className="p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-7 w-20" />
      </Card>
    );
  }
  return (
    <StatCard
      icon={props.icon}
      label={props.label}
      value={props.value ?? '—'}
      tone={props.tone}
    />
  );
}

const CHECK_LABELS: Record<string, string> = {
  cacheHit: 'Cache hit ≥ 95%',
  noBlocking: 'No blocking sessions',
  noLongQueries: 'No queries > 60s',
  lowDeadTuples: 'Dead tuples < 5%',
};

function HealthScore({
  data,
  loading,
}: {
  data: Overview | null;
  loading: boolean;
}) {
  const score = data?.healthScore ?? 0;
  const color =
    score >= 80
      ? 'var(--color-ok)'
      : score >= 50
        ? 'var(--color-warn)'
        : 'var(--color-danger)';

  return (
    <Card className="flex flex-col items-center p-6">
      <div className="text-sm text-muted">Health Score</div>
      {loading && !data ? (
        <Skeleton className="my-4 h-20 w-28" />
      ) : (
        <div
          className="my-3 text-6xl font-bold"
          style={{ color }}
        >
          {score}
          <span className="text-2xl text-muted">/100</span>
        </div>
      )}

      <div className="mt-2 w-full space-y-2">
        {data &&
          (Object.keys(CHECK_LABELS) as (keyof Overview['checks'])[]).map(
            (key) => {
              const c = data.checks[key];
              return (
                <div
                  key={key}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted">{CHECK_LABELS[key]}</span>
                  {c.ok ? (
                    <CheckCircle2
                      size={16}
                      className="text-[color:var(--color-ok)]"
                    />
                  ) : (
                    <XCircle
                      size={16}
                      className="text-[color:var(--color-danger)]"
                    />
                  )}
                </div>
              );
            }
          )}
      </div>
    </Card>
  );
}
