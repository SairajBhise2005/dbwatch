import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { extractError } from '../lib/format';

interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

// Generic auto-refreshing GET. Polls `path` every `intervalMs`,
// exposes a `reload()` for immediate refresh after mutations.
export function usePolling<T>(path: string, intervalMs = 10_000): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await api.get<T>(path);
        if (active) {
          setData(res.data);
          setError(null);
        }
      } catch (err) {
        if (active) setError(extractError(err));
      } finally {
        if (active) setLoading(false);
      }
    }

    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [path, intervalMs, tick]);

  return { data, error, loading, reload };
}
