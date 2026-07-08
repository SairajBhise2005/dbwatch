import { useState } from 'react';
import { Download, Trash2, DatabaseBackup, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { usePolling } from '../hooks/usePolling';
import { api } from '../lib/api';
import { Card, Skeleton, ErrorStrip } from '../components/ui';
import { ConfirmModal } from '../components/ConfirmModal';
import { formatBytes, extractError } from '../lib/format';
import type { BackupListResponse, Backup } from '../types';

export function Backups() {
  const { data, error, loading, reload } = usePolling<BackupListResponse>(
    '/backup/list',
    10_000
  );
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [target, setTarget] = useState<Backup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  const backups = data?.backups ?? [];
  const busyCreate = creating || data?.inProgress;

  async function createBackup() {
    setCreating(true);
    setActionError('');
    setNotice('');
    try {
      const { data: res } = await api.post('/backup/create');
      const pruned = res.pruned?.length
        ? ` · pruned ${res.pruned.length} old backup(s)`
        : '';
      setNotice(`Backup created: ${res.filename} (${formatBytes(res.size)})${pruned}`);
      reload();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setCreating(false);
    }
  }

  async function download(name: string) {
    setDownloading(name);
    setActionError('');
    try {
      const res = await api.get(`/backup/download/${encodeURIComponent(name)}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDownloading(null);
    }
  }

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true);
    setActionError('');
    try {
      await api.delete(`/backup/${encodeURIComponent(target.filename)}`);
      setTarget(null);
      reload();
    } catch (err) {
      setActionError(extractError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (error && !data) return <ErrorStrip message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={createBackup}
          disabled={busyCreate}
          className="flex items-center gap-2 rounded-lg bg-[color:var(--color-brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busyCreate ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <DatabaseBackup size={16} />
          )}
          {busyCreate ? 'Backing up…' : 'Take Backup'}
        </button>
        <button
          onClick={reload}
          className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
        >
          <RefreshCw size={15} />
          Refresh
        </button>
        {data?.retention && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} />
            Retention: keep newest {data.retention.keepCount} · drop &gt;{' '}
            {data.retention.keepDays} days
          </span>
        )}
      </div>

      {notice && (
        <div className="rounded-lg border border-[color:var(--color-ok)]/40 bg-[color:var(--color-ok)]/10 px-4 py-3 text-sm text-[color:var(--color-ok)]">
          {notice}
        </div>
      )}
      {actionError && <ErrorStrip message={actionError} />}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[color:var(--color-border)] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Filename</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 text-right font-medium">Size</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-[color:var(--color-border)]">
                      <td colSpan={4} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : backups.map((b) => (
                    <tr key={b.filename} className="border-b border-[color:var(--color-border)]">
                      <td className="px-4 py-2.5 font-mono text-xs">{b.filename}</td>
                      <td className="px-4 py-2.5">
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatBytes(b.size)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => download(b.filename)}
                            disabled={downloading === b.filename}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--color-brand)] hover:bg-[color:var(--color-brand)]/10 disabled:opacity-50"
                          >
                            {downloading === b.filename ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Download size={14} />
                            )}
                            Download
                          </button>
                          <button
                            onClick={() => setTarget(b)}
                            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10"
                          >
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              {!loading && backups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No backups yet. Click <strong>Take Backup</strong> to create one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted">
        Backups use <code>pg_dump -Fc</code> (custom format). Restore is a manual
        admin operation — run <code>pg_restore</code> against a downloaded file.
      </p>

      <ConfirmModal
        open={!!target}
        title="Delete backup?"
        busy={deleting}
        confirmLabel="Delete"
        onCancel={() => setTarget(null)}
        onConfirm={confirmDelete}
        body={
          <>
            Permanently delete <code>{target?.filename}</code> (
            {target ? formatBytes(target.size) : ''})? This cannot be undone.
          </>
        }
      />
    </div>
  );
}
