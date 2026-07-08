// routes/activity.js — GET /api/activity
// "Recent Query Activity" built from pg_stat_activity, ordered by the
// most recent state change. This is the practical alternative to live
// log-file reading (see Architecture&Plan.txt Page 7): same value,
// zero extra infrastructure. Read-only monitoring pool.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await monitorPool.query(
      `SELECT pid,
              usename AS username,
              datname AS database,
              state,
              EXTRACT(EPOCH FROM (now() - state_change)) AS since_seconds,
              EXTRACT(EPOCH FROM (now() - query_start))  AS duration_seconds,
              wait_event_type AS wait_type,
              wait_event,
              query
         FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND query IS NOT NULL
          AND query <> ''
        ORDER BY state_change DESC NULLS LAST
        LIMIT 50`
    );

    const activity = rows.map((r) => ({
      pid: r.pid,
      username: r.username,
      database: r.database,
      state: r.state,
      sinceSeconds: r.since_seconds === null ? null : Number(r.since_seconds),
      durationSeconds:
        r.duration_seconds === null ? null : Number(r.duration_seconds),
      waitType: r.wait_type,
      waitEvent: r.wait_event,
      query: (r.query || '').trim(),
    }));

    res.json({ activity, count: activity.length });
  } catch (err) {
    next(err);
  }
});

export default router;
