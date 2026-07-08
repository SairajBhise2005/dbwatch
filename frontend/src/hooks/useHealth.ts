import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Health } from '../types';

// Polls /api/health so the connection banner stays live.
// Health is a public endpoint, so this works even before login.
export function useHealth(intervalMs = 10_000) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const { data } = await api.get<Health>('/health');
        if (active) setHealth(data);
      } catch (err) {
        // A 503 from the health route still carries a body.
        if (active && axiosHasData(err)) {
          setHealth((err as { response: { data: Health } }).response.data);
        } else if (active) {
          setHealth(null);
        }
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
  }, [intervalMs]);

  return { health, loading };
}

function axiosHasData(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    Boolean((err as { response?: { data?: unknown } }).response?.data)
  );
}
