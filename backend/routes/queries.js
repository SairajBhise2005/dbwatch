// routes/queries.js
//   GET  /api/query-performance        — pg_stat_statements top 50
//   POST /api/query-performance/reset  — pg_stat_statements_reset()
//
// Reads use the monitoring pool. Reset needs elevated rights, so it
// uses the admin pool. If the extension isn't installed, the GET
// responds with { available: false } instead of erroring.

import { Router } from 'express';
import { monitorPool, adminPool } from '../db.js';

const router = Router();

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    // Is the extension present?
    const ext = await monitorPool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`
    );
    if (ext.rowCount === 0) {
      return res.json({
        available: false,
        message:
          'pg_stat_statements is not installed. Add it to ' +
          'shared_preload_libraries and run CREATE EXTENSION (see SETUP_EC2.md).',
        statements: [],
      });
    }

    const { rows } = await monitorPool.query(
      `SELECT queryid,
              query,
              calls,
              total_exec_time,
              mean_exec_time,
              min_exec_time,
              max_exec_time,
              stddev_exec_time,
              rows
         FROM pg_stat_statements
        ORDER BY total_exec_time DESC
        LIMIT 50`
    );

    const statements = rows.map((r) => ({
      queryid: r.queryid === null ? null : String(r.queryid),
      query: (r.query || '').trim(),
      calls: num(r.calls),
      totalTime: Number(num(r.total_exec_time).toFixed(2)),
      meanTime: Number(num(r.mean_exec_time).toFixed(3)),
      minTime: Number(num(r.min_exec_time).toFixed(3)),
      maxTime: Number(num(r.max_exec_time).toFixed(3)),
      stddevTime: Number(num(r.stddev_exec_time).toFixed(3)),
      rows: num(r.rows),
    }));

    res.json({ available: true, statements });
  } catch (err) {
    next(err);
  }
});

router.post('/reset', async (_req, res, next) => {
  try {
    await adminPool.query('SELECT pg_stat_statements_reset()');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
