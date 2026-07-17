import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Info, TrendingDown, TrendingUp, Minus, DollarSign } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { Card, StatCard, Badge, Skeleton, ErrorStrip } from '../components/ui';
import type { CostOverview } from '../types';

const money = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toFixed(2)}`;

export function Cost() {
  const { data, error, loading } = usePolling<CostOverview>('/cost/overview', 60_000);

  if (error && !data) return <ErrorStrip message={error} />;

  if (data && !data.available) {
    return (
      <Card className="flex items-start gap-3 p-5">
        <Info size={20} className="mt-0.5 text-[color:var(--color-warn)]" />
        <div>
          <h2 className="text-sm font-semibold">Cost data unavailable</h2>
          <p className="mt-1 text-sm text-muted">{data.message}</p>
        </div>
      </Card>
    );
  }

  if (loading && !data) {
    return <Skeleton className="h-64 w-full" />;
  }

  const b = data?.breakdown;
  const rec = data?.recommendation;

  const chartData = [
    { name: 'Current', cost: b?.totalMonthly ?? 0, kind: 'current' },
    ...(data?.scenarios ?? []).map((s) => ({
      name: `${s.direction}\n${s.instanceClass.replace('db.', '')}`,
      cost: s.monthlyCost,
      kind: s.direction,
    })),
  ];
  const barColor = (kind: string) =>
    kind === 'current'
      ? 'var(--color-muted)'
      : kind === 'downscale'
        ? 'var(--color-ok)'
        : 'var(--color-warn)';

  return (
    <div className="space-y-6">
      {/* Monthly bill breakdown */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={<DollarSign size={18} />} label="Instance / month" value={money(b?.instanceCost)} sub={data?.instance?.class} />
        <StatCard icon={<DollarSign size={18} />} label="Storage / month" value={money(b?.storageCost)} sub={`${data?.instance?.storageGb ?? 0} GB`} />
        <StatCard
          icon={<DollarSign size={18} />}
          label="Projected monthly bill"
          value={money(b?.totalMonthly)}
          tone="ok"
        />
      </div>

      {/* Recommendation */}
      {rec && (
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            {rec.action === 'downscale' ? (
              <TrendingDown size={18} className="text-[color:var(--color-ok)]" />
            ) : rec.action === 'upscale' ? (
              <TrendingUp size={18} className="text-[color:var(--color-warn)]" />
            ) : (
              <Minus size={18} className="text-muted" />
            )}
            <h2 className="text-sm font-semibold">Scaling recommendation</h2>
            <Badge tone={rec.action === 'downscale' ? 'ok' : rec.action === 'upscale' ? 'warn' : 'neutral'}>
              {rec.action}
            </Badge>
          </div>
          <p className="text-sm text-muted">{rec.rationale}</p>
          {rec.action !== 'right-sized' && (
            <p className="mt-2 text-sm">
              Move to <span className="font-semibold">{rec.targetClass}</span> —{' '}
              <span
                className={
                  (rec.monthlyDelta ?? 0) < 0
                    ? 'font-semibold text-[color:var(--color-ok)]'
                    : 'font-semibold text-[color:var(--color-warn)]'
                }
              >
                {(rec.monthlyDelta ?? 0) < 0 ? 'save' : 'add'} {money(Math.abs(rec.monthlyDelta ?? 0))}/month
              </span>
              {data?.utilization?.avgCpu != null && (
                <span className="text-muted"> · avg CPU {data.utilization.avgCpu}%</span>
              )}
            </p>
          )}
        </Card>
      )}

      {/* Scaling cost comparison */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-semibold">Monthly cost by instance size</h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 20, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} interval={0} />
              <YAxis stroke="var(--color-muted)" fontSize={11} unit="$" />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`$${v.toFixed(2)}`, 'Monthly']}
              />
              <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={barColor(d.kind)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {data?.pricingNote && (
          <p className="mt-3 text-xs text-muted">{data.pricingNote}</p>
        )}
      </Card>
    </div>
  );
}
