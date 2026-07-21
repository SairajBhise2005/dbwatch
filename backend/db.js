// ─────────────────────────────────────────────────────────────
// db.js — PostgreSQL connection pools
//
// Two separate pools by design:
//   • monitorPool — the read-only `dbwatch` role. Everything the
//     dashboard does automatically (metrics, sessions, stats) uses
//     this. It physically cannot write to your database.
//   • adminPool   — the privileged role. Used ONLY for the manual
//     SQL editor and backups (later stages), never for polling.
//
// Neither pool throws on startup if the DB is unreachable — the
// /api/health endpoint reports the status instead, so the server
// always boots and the frontend can show a "disconnected" banner.
// ─────────────────────────────────────────────────────────────

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true';
const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

const baseConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'postgres',
  ssl: sslConfig,
  // Keep pools small — this is a monitoring tool, not a busy app.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

// Read-only monitoring pool (used everywhere by default).
export const monitorPool = new Pool({
  ...baseConfig,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Belt-and-braces: force this pool's sessions to read-only so even
  // a mistaken write query is rejected at the transaction level.
  options: '-c default_transaction_read_only=on',
});

// Privileged pool (SQL editor + backups only — wired up later).
export const adminPool = new Pool({
  ...baseConfig,
  user: process.env.DB_ADMIN_USER,
  password: process.env.DB_ADMIN_PASSWORD,
});

// One-off admin client to an ARBITRARY database. Postgres connections
// are per-database, so browsing/creating objects in a database other
// than DB_NAME needs a fresh connection. Caller must .end().
// ponytail: per-request client, fine for occasional admin browsing;
// pool per-db if this ever gets hot.
export function adminClientFor(database) {
  return new pg.Client({
    host: baseConfig.host,
    port: baseConfig.port,
    ssl: sslConfig,
    connectionTimeoutMillis: 5_000,
    user: process.env.DB_ADMIN_USER,
    password: process.env.DB_ADMIN_PASSWORD,
    database,
  });
}

export const DEFAULT_DB = baseConfig.database;

// Surface pool-level errors instead of crashing the process.
monitorPool.on('error', (err) => {
  console.error('[monitorPool] idle client error:', err.message);
});
adminPool.on('error', (err) => {
  console.error('[adminPool] idle client error:', err.message);
});

/**
 * Run a query on the read-only monitoring pool.
 * @param {string} text - SQL text (parameterized).
 * @param {any[]} [params] - Query parameters.
 */
export function query(text, params) {
  return monitorPool.query(text, params);
}

/**
 * Lightweight connectivity check used by /api/health.
 * Returns { connected, version, error } and never throws.
 */
export async function checkConnection() {
  try {
    const { rows } = await monitorPool.query(
      'SELECT version() AS version, current_database() AS database, now() AS server_time'
    );
    return {
      connected: true,
      version: rows[0].version,
      database: rows[0].database,
      serverTime: rows[0].server_time,
      error: null,
    };
  } catch (err) {
    return {
      connected: false,
      version: null,
      database: null,
      serverTime: null,
      error: err.message,
    };
  }
}
