import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Activity,
  Database,
  Gauge,
  Terminal,
  Archive,
  ScrollText,
  Lightbulb,
  FolderTree,
  Cloud,
  DollarSign,
  LogOut,
  Eye,
  Sun,
  Moon,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ConnectionBanner } from './ConnectionBanner';
import { useHealth } from '../hooks/useHealth';
import { useTheme } from '../hooks/useTheme';

// Navigation grouped into instrument sections. Group labels double as
// structural eyebrows; the order encodes a workflow (watch → query → cloud).
const NAV_GROUPS = [
  {
    label: 'Monitoring',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/sessions', label: 'Live Telemetry', icon: Activity },
      { to: '/database-stats', label: 'Database Stats', icon: Database },
      { to: '/activity', label: 'Recent Activity', icon: ScrollText },
    ],
  },
  {
    label: 'Query & Data',
    items: [
      { to: '/query-performance', label: 'Query Performance', icon: Gauge },
      { to: '/sql-editor', label: 'SQL Editor', icon: Terminal },
      { to: '/explorer', label: 'Database Viewer', icon: FolderTree },
      { to: '/insights', label: 'Tuning Insights', icon: Lightbulb },
      { to: '/backups', label: 'Backup Manager', icon: Archive },
    ],
  },
  {
    label: 'AWS Cloud',
    items: [
      { to: '/cloud', label: 'Infra Vitals', icon: Cloud },
      { to: '/cost', label: 'Cost Realization', icon: DollarSign },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export function Layout({ children, onLogout }: Props) {
  const { health, loading } = useHealth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const current = NAV_ITEMS.find((n) => n.to === location.pathname);
  const currentGroup = NAV_GROUPS.find((g) => g.items.some((i) => i.to === location.pathname));
  const connected = health?.db.connected;
  const disconnected = health != null && !connected;
  const versionShort = health?.db.version?.match(/PostgreSQL\s+[\d.]+/)?.[0]?.replace('PostgreSQL', 'PG');

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-sidebar)]">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--color-brand)]">
            <Eye size={19} className="text-[color:var(--color-on-brand)]" />
          </div>
          <div>
            <div className="text-[15px] font-semibold leading-tight tracking-tight">DBWatch</div>
            <div className="eyebrow mt-0.5">Postgres · RDS</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="eyebrow px-3 pb-1.5">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-r-lg border-l-2 py-2 pl-3 pr-3 text-sm transition-colors ${
                        isActive
                          ? 'border-[color:var(--color-brand)] bg-[color:var(--color-surface-2)] font-medium text-[color:var(--color-text)]'
                          : 'border-transparent text-muted hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon size={17} className={isActive ? 'text-[color:var(--color-brand)]' : ''} />
                        {label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Live status readout */}
        <div className="border-t border-[color:var(--color-border)] px-5 py-3">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'pulse-dot bg-[color:var(--color-ok)]' : 'bg-[color:var(--color-danger)]'}`}
            />
            <span className={connected ? 'text-[color:var(--color-ok)]' : 'text-[color:var(--color-danger)]'}>
              {loading && !health ? 'CONNECTING' : connected ? 'ONLINE' : 'OFFLINE'}
            </span>
            {versionShort && <span className="ml-auto text-muted">{versionShort}</span>}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="m-3 mt-0 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]"
        >
          <LogOut size={17} />
          Log out
        </button>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3">
          <div>
            <div className="eyebrow">{currentGroup?.label ?? 'DBWatch'}</div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">{current?.label ?? 'DBWatch'}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionBanner health={health} loading={loading} />
            <button
              onClick={toggle}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--color-border)] text-muted transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]"
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>
        {disconnected && (
          <div className="flex items-center gap-2 border-b border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-6 py-2 text-sm text-[color:var(--color-danger)]">
            <WifiOff size={15} />
            Lost connection to the database — showing last known data. Retrying every 10s…
          </div>
        )}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
