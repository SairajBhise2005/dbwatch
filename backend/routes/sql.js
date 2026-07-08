// routes/sql.js — the manual SQL editor.
//   POST /api/sql/execute          — run SQL, return rows
//   POST /api/sql/explain          — EXPLAIN (plan text)
//   POST /api/sql/explain-analyze  — EXPLAIN ANALYZE (rolled back)
//
// This is the ONE place the dashboard can write, and it's explicitly
// manual. Runs on the admin pool. Safety measures:
//   • every statement runs under a 15s statement_timeout
//   • SELECTs without a LIMIT get an automatic LIMIT 500 appended
//   • EXPLAIN ANALYZE runs inside a transaction that is ROLLED BACK,
//     so analyzing an INSERT/UPDATE/DELETE never mutates data

import { Router } from 'express';
import { adminPool } from '../db.js';

const router = Router();

const TIMEOUT_MS = 15_000;
const ROW_LIMIT = 500;

// Strip a single trailing semicolon + whitespace.
function clean(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '');
}

// Append LIMIT 500 to a bare single-statement SELECT.
function withSafetyLimit(sql) {
  const isSelect = /^\s*(with[\s\S]+?\)\s*)?select\b/i.test(sql);
  const hasLimit = /\blimit\s+\d+/i.test(sql);
  const multiStatement = sql.includes(';');
  if (isSelect && !hasLimit && !multiStatement) {
    return `${sql}\nLIMIT ${ROW_LIMIT}`;
  }
  return sql;
}

// Run SQL on a dedicated admin client with a local timeout.
// rollback=true wraps in a transaction that is always rolled back.
async function run(sql, { rollback = false } = {}) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    const result = await client.query(sql);
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

router.post('/execute', async (req, res) => {
  const sql = clean(req.body?.sql);
  if (!sql) return res.status(400).json({ error: 'No SQL provided' });

  const finalSql = withSafetyLimit(sql);
  const limited = finalSql !== sql;
  try {
    const result = await run(finalSql, { rollback: false });
    res.json({
      command: result.command,
      rowCount: result.rowCount,
      fields: (result.fields || []).map((f) => f.name),
      rows: result.rows || [],
      limitApplied: limited ? ROW_LIMIT : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/explain', async (req, res) => {
  const sql = clean(req.body?.sql);
  if (!sql) return res.status(400).json({ error: 'No SQL provided' });
  try {
    const result = await run(`EXPLAIN ${sql}`, { rollback: true });
    res.json({ plan: result.rows.map((r) => r['QUERY PLAN']).join('\n') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/explain-analyze', async (req, res) => {
  const sql = clean(req.body?.sql);
  if (!sql) return res.status(400).json({ error: 'No SQL provided' });
  try {
    // ANALYZE actually executes the query; rollback undoes any writes.
    const result = await run(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, {
      rollback: true,
    });
    res.json({ plan: result.rows.map((r) => r['QUERY PLAN']).join('\n') });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
