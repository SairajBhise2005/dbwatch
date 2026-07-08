// routes/sessions.js
//   GET    /api/sessions       — live pg_stat_activity snapshot
//   DELETE /api/sessions/:pid  — pg_terminate_backend(pid)
//
// Reads use the monitoring pool. Terminate needs elevated rights
// (pg_signal_backend), so it uses the admin pool.

import { Router } from 'express';
import { monitorPool, adminPool } from '../db.js';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await monitorPool.query(
      `SELECT pid,
              usename        AS username,
              datname        AS database,
              state,
              client_addr    AS client,
              wait_event_type AS wait_type,
              wait_event,
              EXTRACT(EPOCH FROM (now() - query_start))  AS duration_seconds,
              EXTRACT(EPOCH FROM (now() - state_change)) AS state_seconds,
              query
         FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND state IS NOT NULL
        ORDER BY query_start ASC NULLS LAST`
    );

    const sessions = rows.map((r) => ({
      pid: r.pid,
      username: r.username,
      database: r.database,
      state: r.state,
      client: r.client,
      waitType: r.wait_type,
      waitEvent: r.wait_event,
      durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
      stateSeconds: r.state_seconds === null ? null : Number(r.state_seconds),
      query: (r.query || '').trim(),
    }));

    res.json({ sessions, count: sessions.length });
  } catch (err) {
    next(err);
  }
});

router.delete('/:pid', async (req, res, next) => {
  const pid = Number(req.params.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    return res.status(400).json({ error: 'Invalid pid' });
  }
  try {
    // Guard: never let the tool terminate its own backends.
    const { rows } = await adminPool.query(
      'SELECT pg_terminate_backend($1) AS terminated',
      [pid]
    );
    res.json({ pid, terminated: rows[0].terminated === true });
  } catch (err) {
    next(err);
  }
});

export default router;
