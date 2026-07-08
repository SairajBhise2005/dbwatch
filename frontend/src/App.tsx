import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Sessions } from './pages/Sessions';
import { DatabaseStats } from './pages/DatabaseStats';
import { QueryPerformance } from './pages/QueryPerformance';
import { SqlEditor } from './pages/SqlEditor';
import { Backups } from './pages/Backups';
import { Insights } from './pages/Insights';
import { Explorer } from './pages/Explorer';
import { Activity } from './pages/Activity';
import { Placeholder } from './pages/Placeholder';
import { getStoredPassword, logout } from './lib/api';

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getStoredPassword());

  // If any request 401s, api.ts fires this event — drop to login.
  useEffect(() => {
    const handler = () => setAuthed(false);
    window.addEventListener('dbwatch:unauthorized', handler);
    return () => window.removeEventListener('dbwatch:unauthorized', handler);
  }, []);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <Layout
      onLogout={() => {
        logout();
        setAuthed(false);
      }}
    >
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/database-stats" element={<DatabaseStats />} />
        <Route path="/query-performance" element={<QueryPerformance />} />
        <Route path="/sql-editor" element={<SqlEditor />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/explorer" element={<Explorer />} />
        <Route path="*" element={<Placeholder title="Not found" stage="—" />} />
      </Routes>
    </Layout>
  );
}
