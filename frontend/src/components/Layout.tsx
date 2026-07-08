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

// The nine dashboard pages, matching the project plan.
// `ready: false` pages render a "coming in a later stage" placeholder.
export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, ready: true },
  { to: '/sessions', label: 'Active Sessions', icon: Activity, ready: true },
  { to: '/database-stats', label: 'Database Stats', icon: Database, ready: true },
  { to: '/query-performance', label: 'Query Performance', icon: Gauge, ready: true },
  { to: '/sql-editor', label: 'SQL Editor', icon: Terminal, ready: true },
  { to: '/backups', label: 'Backup Manager', icon: Archive, ready: true },
  { to: '/activity', label: 'Recent Activity', icon: ScrollText, ready: true },
  { to: '/insights', label: 'Cost & Insights', icon: Lightbulb, ready: true },
  { to: '/explorer', label: 'DB Explorer', icon: FolderTree, ready: true },
] as const;

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export function Layout({ children, onLogout }: Props) {
  const { health, loading } = useHealth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const current = NAV_ITEMS.find((n) => n.to === location.pathname);
  const disconnected = health != null && !health.db.connected;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)]">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--color-brand)]">
            <Eye size={18} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">DBWatch</div>
            <div className="text-xs text-muted">PostgreSQL Monitor</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-[color:var(--color-surface-2)] text-[color:var(--color-text)]'
                    : 'text-muted hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]'
                }`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={onLogout}
          className="m-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]"
        >
          <LogOut size={17} />
          Log out
        </button>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-3.5">
          <h1 className="text-lg font-semibold">{current?.label ?? 'DBWatch'}</h1>
          <div className="flex items-center gap-3">
            <ConnectionBanner health={health} loading={loading} />
            <button
              onClick={toggle}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--color-border)] text-muted hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]"
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
