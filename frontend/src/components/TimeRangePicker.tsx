import { useEffect, useRef, useState } from 'react';
import { Clock, ChevronDown, Play, Square } from 'lucide-react';

export interface Preset {
  label: string;
  minutes: number;
}

interface Props {
  value: number; // window in minutes (0 = zeroLabel)
  onChange: (minutes: number) => void;
  presets: Preset[];
  zeroLabel?: string;
  refreshMs: number;
  onRefreshChange: (ms: number) => void;
  align?: 'left' | 'right';
}

const RECENT_KEY = 'dbwatch_time_recent';
const UNIT_MIN: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };

export function labelForMinutes(min: number, zeroLabel = 'All time'): string {
  if (!min) return zeroLabel;
  if (min % 1440 === 0) return `Last ${min / 1440} day${min / 1440 > 1 ? 's' : ''}`;
  if (min % 60 === 0) return `Last ${min / 60} hour${min / 60 > 1 ? 's' : ''}`;
  return `Last ${min} minute${min > 1 ? 's' : ''}`;
}

export function TimeRangePicker({ value, onChange, presets, zeroLabel = 'All time', refreshMs, onRefreshChange, align = 'left' }: Props) {
  const [open, setOpen] = useState(false);
  const [qn, setQn] = useState('15');
  const [qunit, setQunit] = useState('minutes');
  const [rn, setRn] = useState(() => (refreshMs && refreshMs % 60000 === 0 ? String(refreshMs / 60000) : String((refreshMs || 0) / 1000 || 10)));
  const [runit, setRunit] = useState(refreshMs && refreshMs % 60000 === 0 ? 'minutes' : 'seconds');
  const [running, setRunning] = useState(refreshMs > 0);
  const [recent, setRecent] = useState<Preset[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(minutes: number, label: string) {
    onChange(minutes);
    const next = [{ label, minutes }, ...recent.filter((r) => r.minutes !== minutes)].slice(0, 4);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    setOpen(false);
  }

  function applyQuick() {
    const n = Math.max(1, Math.floor(Number(qn) || 0));
    pick(n * (UNIT_MIN[qunit] || 1), labelForMinutes(n * (UNIT_MIN[qunit] || 1), zeroLabel));
  }

  function toggleRefresh() {
    if (running) {
      setRunning(false);
      onRefreshChange(0);
    } else {
      const n = Math.max(1, Math.floor(Number(rn) || 0));
      const ms = n * (runit === 'minutes' ? 60000 : 1000);
      setRunning(true);
      onRefreshChange(ms);
    }
  }

  const inputCls =
    'rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] px-2 py-1.5 text-sm outline-none focus:border-[color:var(--color-brand)]';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm hover:bg-[color:var(--color-surface-2)]"
      >
        <Clock size={15} className="text-[color:var(--color-brand)]" />
        {labelForMinutes(value, zeroLabel)}
        {running && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[color:var(--color-ok)]" />}
        <ChevronDown size={14} className="text-muted" />
      </button>

      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} z-50 mt-2 w-96 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 shadow-2xl`}>
          {/* Quick select */}
          <div className="eyebrow mb-2">Quick select</div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">Last</span>
            <input type="number" min={1} value={qn} onChange={(e) => setQn(e.target.value)} className={`${inputCls} w-16`} />
            <select value={qunit} onChange={(e) => setQunit(e.target.value)} className={inputCls}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
            <button
              onClick={applyQuick}
              className="ml-auto rounded-md bg-[color:var(--color-brand)] px-4 py-1.5 text-sm font-medium text-[color:var(--color-on-brand)] hover:opacity-90"
            >
              Apply
            </button>
          </div>

          {/* Commonly used */}
          <div className="eyebrow mb-2 mt-4">Commonly used</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => pick(p.minutes, p.label)}
                className={`text-left text-sm hover:underline ${p.minutes === value ? 'font-semibold text-[color:var(--color-brand)]' : 'text-[color:var(--color-brand)]'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Recently used */}
          {recent.length > 0 && (
            <>
              <div className="eyebrow mb-2 mt-4">Recently used</div>
              <div className="space-y-1">
                {recent.map((r) => (
                  <button key={r.label} onClick={() => pick(r.minutes, r.label)} className="block text-left text-sm text-[color:var(--color-brand)] hover:underline">
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Refresh every */}
          <div className="mt-4 border-t border-[color:var(--color-border)] pt-3">
            <div className="eyebrow mb-2">Refresh every</div>
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={rn} onChange={(e) => setRn(e.target.value)} className={`${inputCls} w-20`} />
              <select value={runit} onChange={(e) => setRunit(e.target.value)} className={inputCls}>
                <option value="seconds">seconds</option>
                <option value="minutes">minutes</option>
              </select>
              <button
                onClick={toggleRefresh}
                className={`ml-auto flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium ${
                  running
                    ? 'bg-[color:var(--color-danger)] text-white hover:opacity-90'
                    : 'border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-2)]'
                }`}
              >
                {running ? <Square size={13} /> : <Play size={13} />}
                {running ? 'Stop' : 'Start'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
