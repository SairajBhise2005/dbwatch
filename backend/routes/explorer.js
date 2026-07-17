// routes/explorer.js — read-only object browser (Stage 5)
//   GET /api/explorer               — tree data: tables, views, indexes, roles
//   GET /api/explorer/tables/:name  — table detail: columns, indexes, size
//
// Everything here is read-only and uses the monitoring pool. Table
// name is passed as a query PARAMETER (not interpolated), so it's
// injection-safe.

import { Router } from 'express';
import { monitorPool, adminPool } from '../db.js';

const router = Router();

// Strict identifier + type allowlists for the create-DDL endpoints.
// Because names are validated against these, quoting them is injection-safe.
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const ALLOWED_TYPES = new Set([
  'smallint', 'integer', 'bigint', 'serial', 'bigserial',
  'text', 'varchar', 'boolean', 'date', 'timestamp', 'timestamptz',
  'numeric', 'real', 'double precision', 'uuid', 'json', 'jsonb',
]);

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (_req, res, next) => {
  try {
    const [tables, views, indexes, roles, dbRow] = await Promise.all([
      monitorPool.query(
        `SELECT t.schemaname AS schema, t.relname AS name,
                t.n_live_tup AS row_estimate,
                pg_total_relation_size(t.relid) AS size_bytes,
                (SELECT count(*) FROM pg_index i WHERE i.indrelid = t.relid) AS index_count
           FROM pg_stat_user_tables t
          ORDER BY pg_total_relation_size(t.relid) DESC`
      ),
      monitorPool.query(
        `SELECT schemaname AS schema, viewname AS name
           FROM pg_views
          WHERE schemaname NOT IN ('pg_catalog','information_schema')
          ORDER BY viewname`
      ),
      monitorPool.query(
        `SELECT s.schemaname AS schema, s.relname AS table_name,
                s.indexrelname AS name,
                pg_relation_size(s.indexrelid) AS size_bytes,
                s.idx_scan AS scans,
                i.indisunique AS is_unique, i.indisprimary AS is_primary
           FROM pg_stat_user_indexes s
           JOIN pg_index i ON i.indexrelid = s.indexrelid
          ORDER BY s.relname, s.indexrelname`
      ),
      monitorPool.query(
        `SELECT rolname AS name, rolcanlogin AS can_login,
                rolsuper AS is_superuser, rolcreatedb AS can_create_db,
                rolcreaterole AS can_create_role
           FROM pg_roles
          WHERE rolname NOT LIKE 'pg\\_%'
          ORDER BY rolname`
      ),
      monitorPool.query('SELECT current_database() AS db'),
    ]);

    res.json({
      database: dbRow.rows[0].db,
      tables: tables.rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        rowEstimate: num(r.row_estimate),
        sizeBytes: num(r.size_bytes),
        indexCount: num(r.index_count),
      })),
      views: views.rows,
      indexes: indexes.rows.map((r) => ({
        schema: r.schema,
        table: r.table_name,
        name: r.name,
        sizeBytes: num(r.size_bytes),
        scans: num(r.scans),
        isUnique: r.is_unique,
        isPrimary: r.is_primary,
      })),
      roles: roles.rows.map((r) => ({
        name: r.name,
        canLogin: r.can_login,
        isSuperuser: r.is_superuser,
        canCreateDb: r.can_create_db,
        canCreateRole: r.can_create_role,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tables/:name', async (req, res, next) => {
  const name = req.params.name;
  const schema = req.query.schema || 'public';
  try {
    // Resolve size + row estimate; regclass cast 404s if table is unknown.
    let meta;
    try {
      meta = await monitorPool.query(
        `SELECT pg_total_relation_size(format('%I.%I',$1::text,$2::text)::regclass) AS size_bytes,
                COALESCE((SELECT n_live_tup FROM pg_stat_user_tables
                           WHERE schemaname=$1::text AND relname=$2::text), 0) AS row_estimate`,
        [schema, name]
      );
    } catch {
      return res.status(404).json({ error: 'Table not found' });
    }

    const [columns, indexes] = await Promise.all([
      monitorPool.query(
        `SELECT column_name AS name, data_type AS type,
                (is_nullable = 'YES') AS nullable, column_default AS default_value
           FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position`,
        [schema, name]
      ),
      monitorPool.query(
        `SELECT indexname AS name, indexdef AS definition
           FROM pg_indexes
          WHERE schemaname = $1 AND tablename = $2
          ORDER BY indexname`,
        [schema, name]
      ),
    ]);

    if (columns.rowCount === 0) {
      return res.status(404).json({ error: 'Table not found' });
    }

    res.json({
      schema,
      name,
      sizeBytes: num(meta.rows[0].size_bytes),
      rowEstimate: num(meta.rows[0].row_estimate),
      columns: columns.rows.map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default: c.default_value,
      })),
      indexes: indexes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/explorer/databases  — create a new database
router.post('/databases', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!IDENT.test(name)) {
    return res.status(400).json({ error: 'Invalid database name (use lowercase letters, digits, underscore).' });
  }
  try {
    // CREATE DATABASE cannot run inside a transaction, so run it directly.
    await adminPool.query(`CREATE DATABASE "${name}"`);
    res.json({ ok: true, created: name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/explorer/tables — create a table from a column spec
router.post('/tables', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const schema = String(req.body?.schema || 'public').trim();
  const columns = Array.isArray(req.body?.columns) ? req.body.columns : [];

  if (!IDENT.test(name)) return res.status(400).json({ error: 'Invalid table name.' });
  if (!IDENT.test(schema)) return res.status(400).json({ error: 'Invalid schema name.' });
  if (columns.length === 0) return res.status(400).json({ error: 'At least one column is required.' });

  const defs = [];
  const pkCols = [];
  for (const col of columns) {
    const cname = String(col?.name || '').trim();
    const ctype = String(col?.type || '').trim().toLowerCase();
    if (!IDENT.test(cname)) return res.status(400).json({ error: `Invalid column name: ${cname}` });
    if (!ALLOWED_TYPES.has(ctype)) return res.status(400).json({ error: `Unsupported type: ${ctype}` });
    let def = `"${cname}" ${ctype}`;
    if (col?.nullable === false) def += ' NOT NULL';
    defs.push(def);
    if (col?.primaryKey) pkCols.push(`"${cname}"`);
  }
  if (pkCols.length) defs.push(`PRIMARY KEY (${pkCols.join(', ')})`);

  const ddl = `CREATE TABLE "${schema}"."${name}" (\n  ${defs.join(',\n  ')}\n)`;
  try {
    await adminPool.query(ddl);
    res.json({ ok: true, created: `${schema}.${name}`, ddl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
