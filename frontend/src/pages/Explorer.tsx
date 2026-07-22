import { useEffect, useState } from 'react';
import {
  Table2,
  Eye,
  KeyRound,
  Users,
  ChevronRight,
  ChevronDown,
  Database,
  Plus,
  Trash2,
  Loader2,
  FileUp,
} from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Badge, Skeleton, ErrorStrip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatBytes, formatNumber, extractError } from '../lib/format';
import type { ExplorerData, TableDetail } from '../types';

type SectionKey = 'tables' | 'views' | 'indexes' | 'roles';

const COLUMN_TYPES = [
  'integer', 'bigint', 'serial', 'bigserial', 'text', 'varchar', 'boolean',
  'date', 'timestamp', 'timestamptz', 'numeric', 'real', 'double precision',
  'uuid', 'json', 'jsonb',
];

interface NewColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export function Explorer() {
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState('');
  const [currentDb, setCurrentDb] = useState('');
  const [dropTarget, setDropTarget] = useState<{ kind: 'db' | 'table'; schema?: string; name: string } | null>(null);
  const [dropBusy, setDropBusy] = useState(false);
  const [dropErr, setDropErr] = useState('');
  const { data, error, loading, reload } = usePolling<ExplorerData>(
    selectedDb ? `/explorer?db=${encodeURIComponent(selectedDb)}` : '/explorer',
    30_000
  );
  const [modal, setModal] = useState<null | 'db' | 'table' | 'import'>(null);
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

  // Load the database list once; default the selector to the connected DB.
  function loadDatabases(pick?: string) {
    api
      .get<{ databases: string[]; current: string }>('/explorer/databases')
      .then(({ data }) => {
        setDatabases(data.databases);
        setCurrentDb(data.current);
        if (pick) setSelectedDb(pick);
        else setSelectedDb((s) => s || data.current);
      })
      .catch(() => {});
  }
  useEffect(loadDatabases, []); // eslint-disable-line react-hooks/exhaustive-deps

  function switchDb(db: string) {
    setSelectedDb(db);
    setSelected(null);
    setDetail(null);
  }

  function toggle(key: SectionKey) {
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  }

  async function selectTable(schema: string, name: string) {
    setSelected(`${schema}.${name}`);
    setDetailLoading(true);
    setDetailError('');
    setDetail(null);
    try {
      const q = new URLSearchParams({ schema });
      if (selectedDb) q.set('db', selectedDb);
      const { data } = await api.get<TableDetail>(
        `/explorer/tables/${encodeURIComponent(name)}?${q.toString()}`
      );
      setDetail(data);
    } catch (err) {
      setDetailError(extractError(err));
    } finally {
      setDetailLoading(false);
    }
  }

  async function confirmDrop() {
    if (!dropTarget) return;
    setDropBusy(true);
    setDropErr('');
    try {
      if (dropTarget.kind === 'db') {
        await api.delete(`/explorer/databases/${encodeURIComponent(dropTarget.name)}`);
        loadDatabases(dropTarget.name === selectedDb ? currentDb : undefined);
      } else {
        const qp = new URLSearchParams({ schema: dropTarget.schema || 'public' });
        if (selectedDb) qp.set('db', selectedDb);
        await api.delete(`/explorer/tables/${encodeURIComponent(dropTarget.name)}?${qp.toString()}`);
        reload();
        setSelected(null);
        setDetail(null);
      }
      setDropTarget(null);
    } catch (e) {
      setDropErr(extractError(e));
    } finally {
      setDropBusy(false);
    }
  }

  if (error && !data) return <ErrorStrip message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted">Database</label>
        <select
          value={selectedDb}
          onChange={(e) => switchDb(e.target.value)}
          className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm"
        >
          {databases.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {selectedDb && selectedDb !== currentDb && (
          <button
            onClick={() => setDropTarget({ kind: 'db', name: selectedDb })}
            title="Drop this database"
            className="flex items-center gap-1.5 rounded-lg border border-[color:var(--color-danger)]/50 px-3 py-2 text-sm text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10"
          >
            <Trash2 size={15} /> Drop
          </button>
        )}
        <button
          onClick={() => setModal('db')}
          className="ml-auto flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <Plus size={15} /> New database
        </button>
        <button
          onClick={() => setModal('import')}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <FileUp size={15} /> Import SQL
        </button>
        <button
          onClick={() => setModal('table')}
          className="flex items-center gap-2 rounded-lg bg-[color:var(--color-brand)] px-3 py-2 text-sm font-medium text-[color:var(--color-on-brand)] hover:opacity-90"
        >
          <Plus size={15} /> New table
        </button>
      </div>

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
                    <div
                      key={id}
                      className={`group flex items-center gap-1 rounded-md pr-1 text-sm ${
                        selected === id
                          ? 'bg-[color:var(--color-surface-2)] text-[color:var(--color-text)]'
                          : 'text-muted hover:bg-[color:var(--color-surface-2)]'
                      }`}
                    >
                      <button
                        onClick={() => selectTable(t.schema, t.name)}
                        className="flex min-w-0 flex-1 items-center justify-between px-2 py-1.5 text-left"
                      >
                        <span className="truncate">{t.name}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted">
                          {formatBytes(t.sizeBytes)}
                        </span>
                      </button>
                      <button
                        onClick={() => setDropTarget({ kind: 'table', schema: t.schema, name: t.name })}
                        title="Drop table"
                        className="shrink-0 rounded p-1 text-muted opacity-0 hover:text-[color:var(--color-danger)] group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
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
          <TableDetailView
            detail={detail}
            db={selectedDb}
            onChanged={() => {
              selectTable(detail.schema, detail.name);
              reload();
            }}
            onRenamed={() => {
              setSelected(null);
              setDetail(null);
              reload();
            }}
          />
        ) : null}
      </div>
      </div>

      {modal === 'db' && (
        <CreateDatabaseModal
          onClose={() => setModal(null)}
          onCreated={(newName) => {
            switchDb(newName);
            loadDatabases(newName);
          }}
        />
      )}
      {modal === 'table' && (
        <CreateTableModal db={selectedDb} onClose={() => setModal(null)} onDone={reload} />
      )}
      {modal === 'import' && (
        <ImportSqlModal db={selectedDb} onClose={() => setModal(null)} onDone={reload} />
      )}
      {dropTarget && (
        <ConfirmModal
          open
          title={`Drop ${dropTarget.kind === 'db' ? 'database' : 'table'}?`}
          busy={dropBusy}
          confirmLabel="Drop"
          confirmText={dropTarget.name}
          onCancel={() => {
            setDropTarget(null);
            setDropErr('');
          }}
          onConfirm={confirmDrop}
          body={
            <>
              This permanently drops{' '}
              <code>{dropTarget.kind === 'db' ? dropTarget.name : `${dropTarget.schema}.${dropTarget.name}`}</code>
              {dropTarget.kind === 'db' ? ' and all its objects' : ''}. This cannot be undone.
              {dropErr && (
                <span className="mt-2 block text-[color:var(--color-danger)]">{dropErr}</span>
              )}
            </>
          }
        />
      )}
    </div>
  );
}

// ── Create database modal ──
function CreateDatabaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await api.post('/explorer/databases', { name });
      onCreated(name);
      onClose();
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalShell title="Create database" onClose={onClose}>
      <label className="mb-1 block text-sm text-muted">Database name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. analytics_db"
        className="w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[color:var(--color-brand)]"
      />
      <p className="mt-2 text-xs text-muted">Lowercase letters, digits, and underscores only.</p>
      {err && <p className="mt-2 text-sm text-[color:var(--color-danger)]">{err}</p>}
      <ModalActions busy={busy} disabled={!name} onCancel={onClose} onConfirm={submit} confirmLabel="Create" />
    </ModalShell>
  );
}

// ── Create table modal ──
function CreateTableModal({ db, onClose, onDone }: { db: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [cols, setCols] = useState<NewColumn[]>([
    { name: 'id', type: 'serial', nullable: false, primaryKey: true },
  ]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const update = (i: number, patch: Partial<NewColumn>) =>
    setCols((c) => c.map((col, idx) => (idx === i ? { ...col, ...patch } : col)));
  const addCol = () => setCols((c) => [...c, { name: '', type: 'text', nullable: true, primaryKey: false }]);
  const removeCol = (i: number) => setCols((c) => c.filter((_, idx) => idx !== i));

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await api.post('/explorer/tables', { db, name, columns: cols });
      onDone();
      onClose();
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Create table in ${db || 'current database'}`} onClose={onClose} wide>
      <label className="mb-1 block text-sm text-muted">Table name</label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. customers"
        className="mb-4 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[color:var(--color-brand)]"
      />
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">Columns</span>
        <button onClick={addCol} className="flex items-center gap-1 text-xs text-[color:var(--color-brand)] hover:underline">
          <Plus size={13} /> Add column
        </button>
      </div>
      <div className="space-y-2">
        {cols.map((col, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={col.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="column"
              className="w-32 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm outline-none"
            />
            <select
              value={col.type}
              onChange={(e) => update(i, { type: e.target.value })}
              className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm"
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={!col.nullable} onChange={(e) => update(i, { nullable: !e.target.checked })} />
              NOT NULL
            </label>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={col.primaryKey} onChange={(e) => update(i, { primaryKey: e.target.checked })} />
              PK
            </label>
            {cols.length > 1 && (
              <button onClick={() => removeCol(i)} className="ml-auto text-muted hover:text-[color:var(--color-danger)]">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {err && <p className="mt-3 text-sm text-[color:var(--color-danger)]">{err}</p>}
      <ModalActions busy={busy} disabled={!name || cols.some((c) => !c.name)} onCancel={onClose} onConfirm={submit} confirmLabel="Create table" />
    </ModalShell>
  );
}

// ── Import .sql modal ──
function ImportSqlModal({ db, onClose, onDone }: { db: string; onClose: () => void; onDone: () => void }) {
  const [sql, setSql] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFilename(f.name);
    f.text().then(setSql).catch(() => setErr('Could not read file'));
  }

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await api.post('/explorer/import', { db, sql });
      onDone();
      onClose();
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Import SQL into ${db || 'current database'}`} onClose={onClose} wide>
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]">
        <FileUp size={15} /> Choose .sql file
        <input type="file" accept=".sql,text/plain" onChange={pickFile} className="hidden" />
      </label>
      {filename && <p className="mt-1 text-xs text-muted">{filename}</p>}
      <p className="mb-1 mt-3 text-sm text-muted">…or paste SQL</p>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        spellCheck={false}
        placeholder="CREATE TABLE …;"
        className="h-48 w-full resize-y rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-bg)] p-3 font-mono text-xs outline-none focus:border-[color:var(--color-brand)]"
      />
      <p className="mt-2 text-xs text-muted">Runs in one transaction — rolls back entirely if any statement fails.</p>
      {err && <p className="mt-2 text-sm text-[color:var(--color-danger)]">{err}</p>}
      <ModalActions busy={busy} disabled={!sql.trim()} onCancel={onClose} onConfirm={submit} confirmLabel="Run import" />
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-lg' : 'max-w-sm'} rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ busy, disabled, onCancel, onConfirm, confirmLabel }: { busy: boolean; disabled: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-surface-2)] disabled:opacity-50">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className="flex items-center gap-2 rounded-lg bg-[color:var(--color-brand)] px-4 py-2 text-sm font-medium text-[color:var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}

function TableDetailView({
  detail,
  db,
  onChanged,
  onRenamed,
}: {
  detail: TableDetail;
  db: string;
  onChanged: () => void;
  onRenamed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [colName, setColName] = useState('');
  const [colType, setColType] = useState('text');
  const [colNotNull, setColNotNull] = useState(false);

  async function alter(body: Record<string, unknown>, renamed = false) {
    setBusy(true);
    setErr('');
    try {
      await api.post(`/explorer/tables/${encodeURIComponent(detail.name)}/alter`, {
        db,
        schema: detail.schema,
        ...body,
      });
      if (renamed) onRenamed();
      else onChanged();
    } catch (e) {
      setErr(extractError(e));
    } finally {
      setBusy(false);
    }
  }

  function addColumn() {
    if (!colName) return;
    alter({ action: 'add-column', column: colName, type: colType, nullable: !colNotNull });
    setColName('');
    setColType('text');
    setColNotNull(false);
    setAdding(false);
  }
  function dropColumn(name: string) {
    if (window.confirm(`Drop column "${name}"? This cannot be undone.`)) {
      alter({ action: 'drop-column', column: name });
    }
  }
  function renameTable() {
    const to = window.prompt('New table name:', detail.name);
    if (to && to !== detail.name) alter({ action: 'rename-table', newName: to }, true);
  }

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
        <button
          onClick={renameTable}
          disabled={busy}
          className="ml-auto rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-sm hover:bg-[color:var(--color-surface-2)] disabled:opacity-50"
        >
          Rename
        </button>
      </Card>

      {err && <ErrorStrip message={err} />}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-4 py-2.5">
          <span className="text-sm font-semibold">Columns</span>
          <button
            onClick={() => setAdding((a) => !a)}
            className="flex items-center gap-1 text-xs text-[color:var(--color-brand)] hover:underline"
          >
            <Plus size={13} /> Add column
          </button>
        </div>
        {adding && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-2)]/40 px-4 py-2.5">
            <input
              autoFocus
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              placeholder="column name"
              className="w-40 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm outline-none"
            />
            <select
              value={colType}
              onChange={(e) => setColType(e.target.value)}
              className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm"
            >
              {COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={colNotNull} onChange={(e) => setColNotNull(e.target.checked)} />
              NOT NULL
            </label>
            <button
              onClick={addColumn}
              disabled={busy || !colName}
              className="flex items-center gap-1 rounded-md bg-[color:var(--color-brand)] px-3 py-1.5 text-sm font-medium text-[color:var(--color-on-brand)] hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 size={13} className="animate-spin" />} Add
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Nullable</th>
                <th className="px-4 py-2 font-medium">Default</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {detail.columns.map((c) => (
                <tr key={c.name} className="group border-b border-[color:var(--color-border)]">
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
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => dropColumn(c.name)}
                      disabled={busy}
                      title="Drop column"
                      className="rounded p-1 text-muted opacity-0 hover:text-[color:var(--color-danger)] group-hover:opacity-100 disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
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
