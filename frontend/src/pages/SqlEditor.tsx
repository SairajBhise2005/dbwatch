import { useEffect, useState } from 'react';
import { Play, ScanSearch, Gauge, Loader2, History, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Card, Badge, ErrorStrip } from '../components/ui';
import { formatNumber, extractError } from '../lib/format';
import type { SqlExecuteResult, SqlPlanResult } from '../types';

const HISTORY_KEY = 'dbwatch_sql_history';
const MAX_HISTORY = 20;

type Action = 'execute' | 'explain' | 'explain-analyze';

export function SqlEditor() {
  const [sql, setSql] = useState('SELECT * FROM pg_stat_activity;');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SqlExecuteResult | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore malformed history */
    }
  }, []);

  function pushHistory(q: string) {
    setHistory((prev) => {
      const next = [q, ...prev.filter((x) => x !== q)].slice(0, MAX_HISTORY);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }

  async function run(action: Action) {
    const trimmed = sql.trim();
    if (!trimmed) return;
    setBusy(action);
    setError('');
    setResult(null);
    setPlan(null);
    try {
      if (action === 'execute') {
        const { data } = await api.post<SqlExecuteResult>('/sql/execute', { sql: trimmed });
        setResult(data);
      } else {
        const path = action === 'explain' ? '/sql/explain' : '/sql/explain-analyze';
        const { data } = await api.post<SqlPlanResult>(path, { sql: trimmed });
        setPlan(data.plan);
      }
      pushHistory(trimmed);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px]">
      <div className="space-y-4">
        <Card className="p-3">
          <textarea
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            spellCheck={false}
            className="h-44 w-full resize-y rounded-lg bg-[color:var(--color-bg)] p-3 font-mono text-sm outline-none"
            placeholder="Write SQL here…"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ActionButton
              onClick={() => run('execute')}
              busy={busy === 'execute'}
              disabled={busy !== null}
              icon={<Play size={15} />}
              label="Execute"
              primary
            />
            <ActionButton
              onClick={() => run('explain')}
              busy={busy === 'explain'}
              disabled={busy !== null}
              icon={<ScanSearch size={15} />}
              label="EXPLAIN"
            />
            <ActionButton
              onClick={() => run('explain-analyze')}
              busy={busy === 'explain-analyze'}
              disabled={busy !== null}
              icon={<Gauge size={15} />}
              label="EXPLAIN ANALYZE"
            />
            <span className="ml-auto text-xs text-muted">
              SELECTs auto-limited to 500 rows · 15s timeout
            </span>
          </div>
        </Card>

        {error && <ErrorStrip message={error} />}

        {plan !== null && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Query plan</h3>
            <pre className="overflow-x-auto rounded-lg bg-[color:var(--color-bg)] p-3 font-mono text-xs leading-relaxed text-muted">
              {plan}
            </pre>
          </Card>
        )}

        {result && <ResultTable result={result} />}
      </div>

      {/* History sidebar */}
      <Card className="flex flex-col p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History size={15} />
            History
          </div>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-muted hover:text-[color:var(--color-danger)]"
              title="Clear history"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        <div className="space-y-1 overflow-y-auto">
          {history.length === 0 ? (
            <p className="text-xs text-muted">Recent queries appear here.</p>
          ) : (
            history.map((q, i) => (
              <button
                key={i}
                onClick={() => setSql(q)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs text-muted hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]"
                title={q}
              >
                {q}
              </button>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

function ResultTable({ result }: { result: SqlExecuteResult }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--color-border)] px-4 py-2.5 text-sm">
        <Badge tone="info">{result.command || 'OK'}</Badge>
        <span className="text-muted">
          {result.rowCount !== null ? `${formatNumber(result.rowCount)} rows` : ''}
        </span>
        {result.limitApplied && (
          <Badge tone="warn">auto LIMIT {result.limitApplied}</Badge>
        )}
      </div>
      {result.fields.length > 0 ? (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-muted">
              <tr>
                {result.fields.map((f) => (
                  <th key={f} className="px-4 py-2 font-medium">
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className="border-b border-[color:var(--color-border)]">
                  {result.fields.map((f) => (
                    <td key={f} className="px-4 py-2 font-mono text-xs">
                      {renderCell(row[f])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted">
          Statement executed. No rows returned.
        </p>
      )}
    </Card>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ActionButton({
  onClick,
  busy,
  disabled,
  icon,
  label,
  primary,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-opacity disabled:opacity-50 ${
        primary
          ? 'bg-[color:var(--color-brand)] text-[color:var(--color-on-brand)] hover:opacity-90'
          : 'border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-2)]'
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}
