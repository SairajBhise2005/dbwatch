// routes/overview.js — GET /api/overview
// All Home-page metrics + the composite health score in one call.
// Every query runs on the read-only monitoring pool.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();

// pg returns bigint/numeric as strings; coerce safely to Number.
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    const [dbStats, longest, blocking, longRunning, deadTuples] =
      await Promise.all([
        // Per-database counters for the monitored DB.
        monitorPool.query(
          `SELECT numbackends, xact_commit, xact_rollback,
                  blks_read, blks_hit,
                  pg_database_size(current_database()) AS db_size
             FROM pg_stat_database
            WHERE datname = current_database()`
        ),
        // Longest currently-running query (seconds).
        monitorPool.query(
          `SELECT COALESCE(
                    MAX(EXTRACT(EPOCH FROM (now() - query_start))), 0
                  ) AS seconds
             FROM pg_stat_activity
            WHERE state = 'active' AND query_start IS NOT NULL`
        ),
        // Sessions currently blocked by another session.
        monitorPool.query(
          `SELECT count(*) AS n
             FROM pg_stat_activity
            WHERE cardinality(pg_blocking_pids(pid)) > 0`
        ),
        // Active queries running longer than 60s.
        monitorPool.query(
          `SELECT count(*) AS n
             FROM pg_stat_activity
            WHERE state = 'active'
              AND now() - query_start > interval '60 seconds'`
        ),
        // Aggregate dead-tuple ratio across user tables.
        monitorPool.query(
          `SELECT COALESCE(SUM(n_dead_tup), 0) AS dead,
                  COALESCE(SUM(n_live_tup), 0) AS live
             FROM pg_stat_user_tables`
        ),
      ]);

    const s = dbStats.rows[0] || {};
    const blksHit = num(s.blks_hit);
    const blksRead = num(s.blks_read);
    const cacheHitRatio =
      blksHit + blksRead === 0
        ? 100
        : (blksHit / (blksHit + blksRead)) * 100;

    const dead = num(deadTuples.rows[0].dead);
    const live = num(deadTuples.rows[0].live);
    const deadTupleRatio = dead + live === 0 ? 0 : (dead / (dead + live)) * 100;

    const longestSeconds = num(longest.rows[0].seconds);
    const blockingCount = num(blocking.rows[0].n);
    const longRunningCount = num(longRunning.rows[0].n);

    // Health score — 25 pts per rule (see project plan).
    const checks = {
      cacheHit: { ok: cacheHitRatio >= 95, points: 25 },
      noBlocking: { ok: blockingCount === 0, points: 25 },
      noLongQueries: { ok: longRunningCount === 0, points: 25 },
      lowDeadTuples: { ok: deadTupleRatio < 5, points: 25 },
    };
    const healthScore = Object.values(checks).reduce(
      (sum, c) => sum + (c.ok ? c.points : 0),
      0
    );

    res.json({
      activeConnections: num(s.numbackends),
      cacheHitRatio: Number(cacheHitRatio.toFixed(2)),
      commits: num(s.xact_commit),
      rollbacks: num(s.xact_rollback),
      databaseSize: num(s.db_size),
      longestQuerySeconds: Number(longestSeconds.toFixed(1)),
      blockingSessions: blockingCount,
      deadTupleRatio: Number(deadTupleRatio.toFixed(2)),
      healthScore,
      checks,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
