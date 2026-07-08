import { CheckCircle2, Lightbulb, Info } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import type { InsightsResponse, Insight, Severity } from '../types';

const severityTone: Record<Severity, 'danger' | 'warn' | 'neutral'> = {
  High: 'danger',
  Medium: 'warn',
  Low: 'neutral',
};

export function Insights() {
  const { data, error, loading } = usePolling<InsightsResponse>(
    '/insights',
    30_000
  );

  if (error && !data) return <ErrorStrip message={error} />;

  if (loading && !data) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </Card>
        ))}
      </div>
    );
  }

  const insights = data?.insights ?? [];

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <SummaryChip label="High" count={data?.summary.high ?? 0} tone="danger" />
        <SummaryChip label="Medium" count={data?.summary.medium ?? 0} tone="warn" />
        <SummaryChip label="Low" count={data?.summary.low ?? 0} tone="neutral" />
        {data && !data.summary.statementsAvailable && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <Info size={14} />
            Slow-query insights need pg_stat_statements enabled
          </span>
        )}
      </div>

      {insights.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <CheckCircle2 size={40} className="text-[color:var(--color-ok)]" />
          <div>
            <h2 className="text-lg font-semibold">No issues detected</h2>
            <p className="mt-1 text-sm text-muted">
              Your database looks healthy — no tuning recommendations right now.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {insights.map((ins) => (
            <InsightCard key={ins.id} ins={ins} />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: 'danger' | 'warn' | 'neutral';
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2">
      <Badge tone={tone}>{label}</Badge>
      <span className="text-lg font-semibold">{count}</span>
    </div>
  );
}

function InsightCard({ ins }: { ins: Insight }) {
  return (
    <Card className="flex flex-col p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-[color:var(--color-warn)]" />
          <span className="text-sm font-semibold">{ins.category}</span>
        </div>
        <Badge tone={severityTone[ins.severity]}>{ins.severity}</Badge>
      </div>
      <code className="mb-2 block truncate font-mono text-xs text-[color:var(--color-brand)]" title={ins.object}>
        {ins.object}
      </code>
      <p className="text-sm text-muted">{ins.detail}</p>
      <div className="mt-3 border-t border-[color:var(--color-border)] pt-3 text-sm">
        <span className="font-medium">→ </span>
        {ins.recommendation}
      </div>
    </Card>
  );
}
