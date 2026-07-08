// routes/insights.js — GET /api/insights
// The differentiating feature: actionable tuning advice computed
// entirely from PostgreSQL's own statistics views. No AWS API needed.
//
// Each insight = { id, category, severity, object, detail, recommendation }.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();

const num = (v) => (v === null || v === undefined ? 0 : Number(v));
const SEVERITY_RANK = { High: 0, Medium: 1, Low: 2 };
const BIG_TABLE_BYTES = 500 * 1024 * 1024; // 500 MB

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

router.get('/', async (_req, res, next) => {
  try {
    const insights = [];
    let id = 0;
    const add = (o) => insights.push({ id: ++id, ...o });

    // Is pg_stat_statements available?
    const ext = await monitorPool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`
    );
    const hasStatements = ext.rowCount > 0;

    const [noIndex, unusedIdx, deadTuples, cacheRow, bigSeq, slowQueries] =
      await Promise.all([
        // 1. Tables scanned sequentially with zero index usage.
        monitorPool.query(
          `SELECT schemaname, relname, seq_scan, n_live_tup
             FROM pg_stat_user_tables
            WHERE COALESCE(idx_scan,0) = 0 AND seq_scan > 0 AND n_live_tup > 0
            ORDER BY seq_scan DESC LIMIT 25`
        ),
        // 2. Indexes never used (excluding PK / unique).
        monitorPool.query(
          `SELECT s.schemaname, s.relname, s.indexrelname,
                  pg_relation_size(s.indexrelid) AS index_size
             FROM pg_stat_user_indexes s
             JOIN pg_index i ON i.indexrelid = s.indexrelid
            WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
            ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 25`
        ),
        // 3. High dead-tuple ratio (ignoring tiny tables).
        monitorPool.query(
          `SELECT schemaname, relname, n_dead_tup, n_live_tup,
                  round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS dead_pct
             FROM pg_stat_user_tables
            WHERE n_dead_tup > 0
              AND (n_live_tup + n_dead_tup) > 100
              AND n_dead_tup::numeric/nullif(n_live_tup+n_dead_tup,0) > 0.05
            ORDER BY dead_pct DESC LIMIT 25`
        ),
        // 4. Overall cache hit ratio.
        monitorPool.query(
          `SELECT round(100.0*blks_hit/nullif(blks_hit+blks_read,0),2) AS ratio
             FROM pg_stat_database WHERE datname = current_database()`
        ),
        // 6. Large tables (>500MB) doing sequential scans.
        monitorPool.query(
          `SELECT schemaname, relname, seq_scan,
                  pg_relation_size(relid) AS table_size
             FROM pg_stat_user_tables
            WHERE seq_scan > 0 AND pg_relation_size(relid) > $1
            ORDER BY table_size DESC LIMIT 25`,
          [BIG_TABLE_BYTES]
        ),
        // 5. Queries with mean time > 1s (only if extension present).
        hasStatements
          ? monitorPool.query(
              `SELECT query, calls, mean_exec_time
                 FROM pg_stat_statements
                WHERE mean_exec_time > 1000
                ORDER BY mean_exec_time DESC LIMIT 25`
            )
          : Promise.resolve({ rows: [] }),
      ]);

    for (const r of noIndex.rows) {
      const rows = num(r.n_live_tup);
      add({
        category: 'Missing index',
        severity: rows > 100_000 ? 'High' : 'Medium',
        object: `${r.schemaname}.${r.relname}`,
        detail: `${num(r.seq_scan).toLocaleString()} sequential scans, no index scans (${rows.toLocaleString()} rows)`,
        recommendation: 'Consider adding an index on the frequently filtered column(s).',
      });
    }

    for (const r of unusedIdx.rows) {
      const size = num(r.index_size);
      add({
        category: 'Unused index',
        severity: size > 50 * 1024 * 1024 ? 'Medium' : 'Low',
        object: `${r.schemaname}.${r.indexrelname}`,
        detail: `On ${r.relname}, 0 scans, occupying ${fmtBytes(size)}`,
        recommendation: 'Drop this index to save storage and speed up writes.',
      });
    }

    for (const r of deadTuples.rows) {
      const pct = num(r.dead_pct);
      add({
        category: 'Bloat / dead tuples',
        severity: pct > 20 ? 'High' : pct > 10 ? 'Medium' : 'Low',
        object: `${r.schemaname}.${r.relname}`,
        detail: `${pct}% dead tuples (${num(r.n_dead_tup).toLocaleString()} dead / ${num(r.n_live_tup).toLocaleString()} live)`,
        recommendation: 'Run VACUUM on this table to reclaim space.',
      });
    }

    const cacheRatio = num(cacheRow.rows[0]?.ratio);
    if (cacheRow.rows[0]?.ratio !== null && cacheRatio < 90) {
      add({
        category: 'Low cache hit ratio',
        severity: cacheRatio < 80 ? 'High' : 'Medium',
        object: 'database',
        detail: `Cache hit ratio is ${cacheRatio}% (target ≥ 95%)`,
        recommendation: 'Consider increasing shared_buffers.',
      });
    }

    for (const r of bigSeq.rows) {
      add({
        category: 'High I/O risk',
        severity: 'High',
        object: `${r.schemaname}.${r.relname}`,
        detail: `${fmtBytes(num(r.table_size))} table with ${num(r.seq_scan).toLocaleString()} sequential scans`,
        recommendation: 'Large table doing seq scans — an index is strongly recommended.',
      });
    }

    for (const r of slowQueries.rows) {
      add({
        category: 'Slow query',
        severity: num(r.mean_exec_time) > 5000 ? 'High' : 'Medium',
        object: (r.query || '').trim().slice(0, 80),
        detail: `Mean execution time ${(num(r.mean_exec_time) / 1000).toFixed(2)}s over ${num(r.calls).toLocaleString()} calls`,
        recommendation: 'Investigate with EXPLAIN ANALYZE; add indexes or rewrite.',
      });
    }

    insights.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

    const summary = {
      total: insights.length,
      high: insights.filter((i) => i.severity === 'High').length,
      medium: insights.filter((i) => i.severity === 'Medium').length,
      low: insights.filter((i) => i.severity === 'Low').length,
      statementsAvailable: hasStatements,
    };

    res.json({ summary, insights });
  } catch (err) {
    next(err);
  }
});

export default router;
