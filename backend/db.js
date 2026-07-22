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
import { readFileSync } from 'fs';

dotenv.config();

const { Pool } = pg;

const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true';
const sslConfig = useSsl ? { rejectUnauthorized: false } : false;

// ── Optional SSH tunnel (private RDS via a bastion) ──────────────
// When SSH_HOST/SSH_USER/SSH_PRIVATE_KEY_PATH are set, the pools connect
// to a local port that is forwarded through the bastion to the RDS
// endpoint (DB_HOST:DB_PORT). When unset, they connect directly — so a
// public / in-VPC RDS works with no config, a private RDS works via the
// tunnel. TLS is still end-to-end to RDS (keep DB_SSL=true).
export const sshTunnelEnabled = Boolean(
  process.env.SSH_HOST && process.env.SSH_USER && process.env.SSH_PRIVATE_KEY_PATH
);
const LOCAL_PORT = Number(process.env.SSH_LOCAL_PORT) || 6543;

const targetHost = process.env.DB_HOST || '127.0.0.1';
const targetPort = Number(process.env.DB_PORT) || 5432;

const baseConfig = {
  host: sshTunnelEnabled ? '127.0.0.1' : targetHost,
  port: sshTunnelEnabled ? LOCAL_PORT : targetPort,
  database: process.env.DB_NAME || 'postgres',
  ssl: sslConfig,
  // Keep pools small — this is a monitoring tool, not a busy app.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
};

async function startTunnel() {
  try {
    const { createTunnel } = await import('tunnel-ssh');
    await createTunnel(
      { autoClose: false, reconnectOnError: true },
      { host: '127.0.0.1', port: LOCAL_PORT },
      {
        host: process.env.SSH_HOST,
        port: Number(process.env.SSH_PORT) || 22,
        username: process.env.SSH_USER,
        privateKey: readFileSync(process.env.SSH_PRIVATE_KEY_PATH),
        passphrase: process.env.SSH_KEY_PASSPHRASE || undefined,
      },
      { srcAddr: '127.0.0.1', srcPort: LOCAL_PORT, dstAddr: targetHost, dstPort: targetPort }
    );
    console.log(`[ssh] tunnel up: 127.0.0.1:${LOCAL_PORT} → ${targetHost}:${targetPort} via ${process.env.SSH_HOST}`);
  } catch (err) {
    // Non-fatal: /api/health will report the DB as unreachable and the
    // pools retry, so the server still boots.
    console.error('[ssh] tunnel failed:', err.message);
  }
}
if (sshTunnelEnabled) startTunnel();

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
