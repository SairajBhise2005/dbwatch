// routes/queries.js
//   GET  /api/query-performance          — pg_stat_statements top 50
//        ?minutes=N                       — per-window stats (snapshot diff)
//   POST /api/query-performance/reset     — pg_stat_statements_reset()
//
// Reads use the monitoring pool. Reset needs elevated rights → admin pool.
// pg_stat_statements is CUMULATIVE (since last reset), so a time window is
// produced by periodically snapshotting the counters in memory and diffing
// the current values against the snapshot from ~N minutes ago.
// ponytail: in-memory ring buffer, top-300 per sample, 6h horizon — enough
// for "busiest queries lately"; persist to a table if longer history matters.

import { Router } from 'express';
import { monitorPool, adminPool } from '../db.js';

const router = Router();
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

const SAMPLE_MS = 60_000; // sample cadence
const MAX_SNAPS = 360; // ~6h of history
const TOP_N = 300; // statements captured per sample
const SNAPSHOTS = []; // [{ ts, byId: Map(queryid -> {calls,total,rows}) }]

async function extensionPresent() {
  const ext = await monitorPool.query(
    `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`
  );
  return ext.rowCount > 0;
}

async function fetchStatements(limit) {
  const { rows } = await monitorPool.query(
    `SELECT queryid, query, calls, total_exec_time, mean_exec_time,
            min_exec_time, max_exec_time, stddev_exec_time, rows
       FROM pg_stat_statements
      ORDER BY total_exec_time DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// Periodic snapshot for the windowed diff (best-effort; never throws).
async function sample() {
  try {
    if (!(await extensionPresent())) return;
    const rows = await fetchStatements(TOP_N);
    const byId = new Map();
    for (const r of rows) {
      if (r.queryid === null) continue;
      byId.set(String(r.queryid), {
        calls: num(r.calls),
        total: num(r.total_exec_time),
        rows: num(r.rows),
      });
    }
    SNAPSHOTS.push({ ts: Date.now(), byId });
    if (SNAPSHOTS.length > MAX_SNAPS) SNAPSHOTS.shift();
  } catch {
    /* DB down / no perms — skip this sample */
  }
}
setInterval(sample, SAMPLE_MS);
sample();

function shape(s) {
  return {
    queryid: s.queryid === null ? null : String(s.queryid),
    query: (s.query || '').trim(),
    calls: num(s.calls),
    totalTime: Number(num(s.total_exec_time).toFixed(2)),
    meanTime: Number(num(s.mean_exec_time).toFixed(3)),
    minTime: Number(num(s.min_exec_time).toFixed(3)),
    maxTime: Number(num(s.max_exec_time).toFixed(3)),
    stddevTime: Number(num(s.stddev_exec_time).toFixed(3)),
    rows: num(s.rows),
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!(await extensionPresent())) {
      return res.json({
        available: false,
        message:
          'pg_stat_statements is not installed. Add it to ' +
          'shared_preload_libraries and run CREATE EXTENSION (see SETUP_EC2.md).',
        statements: [],
      });
    }

    const minutes = Math.max(0, Math.min(Number(req.query.minutes) || 0, 360));

    // Cumulative (default) — stats since last reset.
    if (minutes === 0) {
      const rows = await fetchStatements(50);
      return res.json({ available: true, windowed: false, statements: rows.map(shape) });
    }

    // Windowed — diff current vs the snapshot from ~N minutes ago.
    const cutoff = Date.now() - minutes * 60_000;
    const older = SNAPSHOTS.filter((s) => s.ts <= cutoff);
    const base = older.length ? older[older.length - 1] : SNAPSHOTS[0];
    if (!base) {
      // No history yet — fall back to cumulative with a note.
      const rows = await fetchStatements(50);
      return res.json({
        available: true,
        windowed: false,
        collecting: true,
        message: 'Collecting history — windowed stats available after the first minute.',
        statements: rows.map(shape),
      });
    }

    const current = await fetchStatements(TOP_N);
    const windowStatements = [];
    for (const r of current) {
      if (r.queryid === null) continue;
      const prev = base.byId.get(String(r.queryid)) || { calls: 0, total: 0, rows: 0 };
      const callsD = num(r.calls) - prev.calls;
      if (callsD <= 0) continue; // no activity in the window
      const totalD = num(r.total_exec_time) - prev.total;
      const rowsD = num(r.rows) - prev.rows;
      windowStatements.push({
        queryid: String(r.queryid),
        query: (r.query || '').trim(),
        calls: callsD,
        totalTime: Number(totalD.toFixed(2)),
        meanTime: Number((callsD > 0 ? totalD / callsD : 0).toFixed(3)),
        minTime: 0,
        maxTime: 0,
        stddevTime: 0,
        rows: rowsD,
      });
    }
    windowStatements.sort((a, b) => b.totalTime - a.totalTime);

    res.json({
      available: true,
      windowed: true,
      windowMinutes: Math.round((Date.now() - base.ts) / 60_000),
      statements: windowStatements.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reset', async (_req, res, next) => {
  try {
    await adminPool.query('SELECT pg_stat_statements_reset()');
    SNAPSHOTS.length = 0; // history is meaningless after a reset
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
