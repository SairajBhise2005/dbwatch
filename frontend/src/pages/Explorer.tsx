import { useState } from 'react';
import {
  Table2,
  Eye,
  KeyRound,
  Users,
  ChevronRight,
  ChevronDown,
  Database,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { formatBytes, formatNumber, extractError } from '../lib/format';
import type { ExplorerData, TableDetail } from '../types';

type SectionKey = 'tables' | 'views' | 'indexes' | 'roles';

export function Explorer() {
  const { data, error, loading } = usePolling<ExplorerData>('/explorer', 30_000);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    tables: true,
    views: false,
    indexes: false,
    roles: false,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  function toggle(key: SectionKey) {
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  }

  async function selectTable(schema: string, name: string) {
    setSelected(`${schema}.${name}`);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      const { data } = await api.get<TableDetail>(
        `/explorer/tables/${encodeURIComponent(name)}?schema=${encodeURIComponent(schema)}`
      );
      setDetail(data);
    } catch (err) {
      setDetailError(extractError(err));
    } finally {
      setDetailLoading(false);
    }
  }

  if (error && !data) return <ErrorStrip message={error} />;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      {/* Tree */}
      <Card className="h-fit overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-3">
          <Database size={16} className="text-[color:var(--color-brand)]" />
          <span className="text-sm font-semibold">{data?.database ?? '…'}</span>
        </div>
        <div className="p-2">
          {loading && !data ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Section
                label="Tables"
                icon={<Table2 size={15} />}
                count={data?.tables.length ?? 0}
                open={open.tables}
                onToggle={() => toggle('tables')}
              >
                {data?.tables.map((t) => {
                  const id = `${t.schema}.${t.name}`;
                  return (
                    <button
                      key={id}
                      onClick={() => selectTable(t.schema, t.name)}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                        selected === id
                          ? 'bg-[color:var(--color-surface-2)] text-[color:var(--color-text)]'
                          : 'text-muted hover:bg-[color:var(--color-surface-2)]'
                      }`}
                    >
                      <span className="truncate">{t.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted">
                        {formatBytes(t.sizeBytes)}
                      </span>
                    </button>
                  );
                })}
              </Section>

              <Section
                label="Views"
                icon={<Eye size={15} />}
                count={data?.views.length ?? 0}
                open={open.views}
                onToggle={() => toggle('views')}
              >
                {data?.views.map((v) => (
                  <div key={`${v.schema}.${v.name}`} className="px-2 py-1.5 text-sm text-muted">
                    {v.name}
                  </div>
                ))}
                {data?.views.length === 0 && <Empty />}
              </Section>

              <Section
                label="Indexes"
                icon={<KeyRound size={15} />}
                count={data?.indexes.length ?? 0}
                open={open.indexes}
                onToggle={() => toggle('indexes')}
              >
                {data?.indexes.map((ix) => (
                  <div
                    key={`${ix.schema}.${ix.name}`}
                    className="flex items-center justify-between px-2 py-1.5 text-sm text-muted"
                  >
                    <span className="truncate" title={`${ix.name} on ${ix.table}`}>
                      {ix.name}
                    </span>
                    {ix.isPrimary ? (
                      <Badge tone="info">PK</Badge>
                    ) : ix.isUnique ? (
                      <Badge tone="neutral">unique</Badge>
                    ) : null}
                  </div>
                ))}
                {data?.indexes.length === 0 && <Empty />}
              </Section>

              <Section
                label="Roles"
                icon={<Users size={15} />}
                count={data?.roles.length ?? 0}
                open={open.roles}
                onToggle={() => toggle('roles')}
              >
                {data?.roles.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between px-2 py-1.5 text-sm text-muted"
                  >
                    <span className="truncate">{r.name}</span>
                    <div className="flex gap-1">
                      {r.isSuperuser && <Badge tone="danger">super</Badge>}
                      {r.canLogin && <Badge tone="neutral">login</Badge>}
                    </div>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>
      </Card>

      {/* Detail */}
      <div>
        {!selected ? (
          <Card className="flex h-64 items-center justify-center text-sm text-muted">
            Select a table to inspect its columns and indexes.
          </Card>
        ) : detailLoading ? (
          <Card className="p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-4 h-32 w-full" />
          </Card>
        ) : detailError ? (
          <ErrorStrip message={detailError} />
        ) : detail ? (
          <TableDetailView detail={detail} />
        ) : null}
      </div>
    </div>
  );
}

function TableDetailView({ detail }: { detail: TableDetail }) {
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <div>
          <div className="text-xs text-muted">Table</div>
          <div className="font-mono text-sm font-semibold">
            {detail.schema}.{detail.name}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Rows (est.)</div>
          <div className="text-sm font-semibold">{formatNumber(detail.rowEstimate)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Total size</div>
          <div className="text-sm font-semibold">{formatBytes(detail.sizeBytes)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Indexes</div>
          <div className="text-sm font-semibold">{detail.indexes.length}</div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[color:var(--color-border)] px-4 py-2.5 text-sm font-semibold">
          Columns
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Nullable</th>
                <th className="px-4 py-2 font-medium">Default</th>
              </tr>
            </thead>
            <tbody>
              {detail.columns.map((c) => (
                <tr key={c.name} className="border-b border-[color:var(--color-border)]">
                  <td className="px-4 py-2 font-mono text-xs">{c.name}</td>
                  <td className="px-4 py-2 text-muted">{c.type}</td>
                  <td className="px-4 py-2">
                    {c.nullable ? (
                      <span className="text-muted">yes</span>
                    ) : (
                      <Badge tone="neutral">NOT NULL</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">
                    {c.default ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {detail.indexes.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-[color:var(--color-border)] px-4 py-2.5 text-sm font-semibold">
            Indexes
          </div>
          <div className="divide-y divide-[color:var(--color-border)]">
            {detail.indexes.map((ix) => (
              <div key={ix.name} className="px-4 py-2.5">
                <div className="font-mono text-xs font-medium">{ix.name}</div>
                <code className="mt-1 block overflow-x-auto text-xs text-muted">
                  {ix.definition}
                </code>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Section({
  label,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-[color:var(--color-surface-2)]"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        {icon}
        {label}
        <span className="ml-auto text-xs text-muted">{count}</span>
      </button>
      {open && <div className="ml-3 border-l border-[color:var(--color-border)] pl-1">{children}</div>}
    </div>
  );
}

function Empty() {
  return <div className="px-2 py-1.5 text-xs text-muted">None</div>;
}
