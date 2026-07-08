// routes/database.js — GET /api/database-stats
// pg_stat_database counters for the monitored database.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await monitorPool.query(
      `SELECT xact_commit, xact_rollback,
              blks_read, blks_hit,
              tup_returned, tup_fetched,
              tup_inserted, tup_updated, tup_deleted,
              conflicts, deadlocks, temp_files, temp_bytes
         FROM pg_stat_database
        WHERE datname = current_database()`
    );

    const r = rows[0] || {};
    const blksHit = num(r.blks_hit);
    const blksRead = num(r.blks_read);
    const cacheHitRatio =
      blksHit + blksRead === 0 ? 100 : (blksHit / (blksHit + blksRead)) * 100;

    res.json({
      commits: num(r.xact_commit),
      rollbacks: num(r.xact_rollback),
      blocksRead: blksRead,
      blocksHit: blksHit,
      rowsReturned: num(r.tup_returned),
      rowsFetched: num(r.tup_fetched),
      rowsInserted: num(r.tup_inserted),
      rowsUpdated: num(r.tup_updated),
      rowsDeleted: num(r.tup_deleted),
      conflicts: num(r.conflicts),
      deadlocks: num(r.deadlocks),
      tempFiles: num(r.temp_files),
      tempBytes: num(r.temp_bytes),
      cacheHitRatio: Number(cacheHitRatio.toFixed(2)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
