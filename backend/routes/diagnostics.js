// routes/diagnostics.js — GET /api/diagnostics
// Automated DB instance health check + issue identifier. Runs a battery
// of read-only checks and returns each as ok / warn / fail with detail,
// plus a rolled-up summary. Powers the Live Telemetry diagnostics panel.

import { Router } from 'express';
import { monitorPool } from '../db.js';

const router = Router();
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    const [conn, active, idleTx, blocking, cache, dead, wrap, unused, longIdle] =
      await Promise.all([
        monitorPool.query(
          `SELECT (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max,
                  count(*) AS cur FROM pg_stat_activity`
        ),
        monitorPool.query(
          `SELECT count(*) FILTER (WHERE state='active' AND now()-query_start > interval '60 seconds') AS over60,
                  COALESCE(MAX(EXTRACT(EPOCH FROM now()-query_start)) FILTER (WHERE state='active'),0) AS max_s
             FROM pg_stat_activity`
        ),
        monitorPool.query(
          `SELECT count(*) FILTER (WHERE state='idle in transaction') AS n,
                  COALESCE(MAX(EXTRACT(EPOCH FROM now()-state_change)) FILTER (WHERE state='idle in transaction'),0) AS max_s
             FROM pg_stat_activity`
        ),
        monitorPool.query(
          `SELECT count(*) AS n FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0`
        ),
        monitorPool.query(
          `SELECT round(100.0*blks_hit/nullif(blks_hit+blks_read,0),2) AS ratio
             FROM pg_stat_database WHERE datname=current_database()`
        ),
        monitorPool.query(
          `SELECT relname, round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS pct
             FROM pg_stat_user_tables WHERE (n_live_tup+n_dead_tup) > 100
             ORDER BY pct DESC NULLS LAST LIMIT 1`
        ),
        monitorPool.query(
          `SELECT max(age(datfrozenxid)) AS max_age,
                  current_setting('autovacuum_freeze_max_age')::bigint AS freeze_max
             FROM pg_database`
        ),
        monitorPool.query(
          `SELECT count(*) AS n FROM pg_stat_user_indexes s
             JOIN pg_index i ON i.indexrelid=s.indexrelid
            WHERE s.idx_scan=0 AND NOT i.indisprimary AND NOT i.indisunique`
        ),
        monitorPool.query(
          `SELECT count(*) AS n FROM pg_stat_activity
            WHERE state='idle' AND now()-state_change > interval '1 hour'`
        ),
      ]);

    const checks = [];
    const add = (name, status, detail) => checks.push({ name, status, detail });

    // 1. Connection saturation
    const maxC = num(conn.rows[0].max);
    const curC = num(conn.rows[0].cur);
    const connPct = maxC ? (curC / maxC) * 100 : 0;
    add(
      'Connection capacity',
      connPct > 90 ? 'fail' : connPct > 75 ? 'warn' : 'ok',
      `${curC} of ${maxC} connections in use (${connPct.toFixed(0)}%).`
    );

    // 2. Long-running queries
    const over60 = num(active.rows[0].over60);
    const maxActive = num(active.rows[0].max_s);
    add(
      'Long-running queries',
      maxActive > 300 ? 'fail' : over60 > 0 ? 'warn' : 'ok',
      over60 > 0
        ? `${over60} query(s) over 60s; longest ${maxActive.toFixed(0)}s.`
        : 'No active query running longer than 60s.'
    );

    // 3. Idle in transaction
    const idleN = num(idleTx.rows[0].n);
    const idleMax = num(idleTx.rows[0].max_s);
    add(
      'Idle in transaction',
      idleMax > 900 ? 'fail' : idleN > 0 && idleMax > 300 ? 'warn' : 'ok',
      idleN > 0
        ? `${idleN} session(s) idle in transaction; longest ${(idleMax / 60).toFixed(1)} min.`
        : 'None.'
    );

    // 4. Blocking sessions
    const blk = num(blocking.rows[0].n);
    add('Blocking sessions', blk > 0 ? 'fail' : 'ok', blk > 0 ? `${blk} blocked session(s).` : 'No lock contention.');

    // 5. Cache hit ratio
    const ratio = cache.rows[0].ratio === null ? 100 : num(cache.rows[0].ratio);
    add('Cache hit ratio', ratio < 90 ? 'fail' : ratio < 95 ? 'warn' : 'ok', `${ratio}% (target ≥ 95%).`);

    // 6. Dead tuple bloat (worst table)
    const worst = dead.rows[0];
    const deadPct = worst ? num(worst.pct) : 0;
    add(
      'Table bloat',
      deadPct > 20 ? 'fail' : deadPct > 10 ? 'warn' : 'ok',
      worst ? `Worst: ${worst.relname} at ${deadPct}% dead tuples.` : 'No user tables.'
    );

    // 7. Transaction ID wraparound risk
    const maxAge = num(wrap.rows[0].max_age);
    const freezeMax = num(wrap.rows[0].freeze_max) || 200_000_000;
    const wrapPct = (maxAge / freezeMax) * 100;
    add(
      'XID wraparound risk',
      wrapPct > 80 ? 'fail' : wrapPct > 50 ? 'warn' : 'ok',
      `Oldest XID age is ${wrapPct.toFixed(0)}% of the autovacuum freeze threshold.`
    );

    // 8. Unused indexes
    const unusedN = num(unused.rows[0].n);
    add('Unused indexes', unusedN > 0 ? 'warn' : 'ok', unusedN > 0 ? `${unusedN} index(es) never used.` : 'None detected.');

    // 9. Long-idle connections
    const longIdleN = num(longIdle.rows[0].n);
    add('Stale idle connections', longIdleN > 0 ? 'warn' : 'ok', longIdleN > 0 ? `${longIdleN} connection(s) idle > 1h.` : 'None.');

    const summary = {
      ok: checks.filter((c) => c.status === 'ok').length,
      warn: checks.filter((c) => c.status === 'warn').length,
      fail: checks.filter((c) => c.status === 'fail').length,
    };
    const overall = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'ok';

    res.json({ overall, summary, checks });
  } catch (err) {
    next(err);
  }
});

export default router;
