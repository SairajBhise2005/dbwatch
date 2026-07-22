// routes/locks.js — GET /api/locks
// Active locks held/awaited by client backends, with blocker→blocked
// relationships (pg_locks + pg_stat_activity + pg_blocking_pids).
// Read-only monitoring pool.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();
const num = (v) => (v === null || v === undefined ? null : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await monitorPool.query(
      `SELECT l.pid,
              a.usename       AS username,
              a.datname       AS database,
              l.locktype,
              l.mode,
              l.granted,
              -- resolve relation OID safely (null if not a table lock)
              (SELECT relname FROM pg_class WHERE oid = l.relation) AS relation,
              a.state,
              EXTRACT(EPOCH FROM (now() - a.query_start)) AS duration_seconds,
              left(a.query, 200) AS query,
              pg_blocking_pids(l.pid) AS blocked_by
         FROM pg_locks l
         JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.pid <> pg_backend_pid()
        ORDER BY l.granted ASC, duration_seconds DESC NULLS LAST
        LIMIT 200`
    );

    const locks = rows.map((r) => ({
      pid: r.pid,
      username: r.username,
      database: r.database,
      locktype: r.locktype,
      mode: r.mode,
      granted: r.granted,
      relation: r.relation,
      state: r.state,
      durationSeconds: num(r.duration_seconds),
      query: (r.query || '').trim(),
      blockedBy: Array.isArray(r.blocked_by) ? r.blocked_by : [],
    }));

    res.json({
      locks,
      total: locks.length,
      waiting: locks.filter((l) => !l.granted).length,
      blocked: locks.filter((l) => l.blockedBy.length > 0).length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
