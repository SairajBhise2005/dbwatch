// ─────────────────────────────────────────────────────────────
// server.js — DBWatch backend entry point.
// Stage 1: Express app, CORS, logging, health endpoint, auth gate.
// Later stages mount more routers under /api.
// ─────────────────────────────────────────────────────────────

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

import healthRouter from './routes/health.js';
import overviewRouter from './routes/overview.js';
import sessionsRouter from './routes/sessions.js';
import databaseRouter from './routes/database.js';
import queriesRouter from './routes/queries.js';
import sqlRouter from './routes/sql.js';
import backupRouter from './routes/backup.js';
import insightsRouter from './routes/insights.js';
import explorerRouter from './routes/explorer.js';
import activityRouter from './routes/activity.js';
import cloudRouter from './routes/cloud.js';
import diagnosticsRouter from './routes/diagnostics.js';
import costRouter from './routes/cost.js';
import locksRouter from './routes/locks.js';
import aiRouter from './routes/ai.js';
import { requireAuth, loginHandler } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// --- Middleware ---
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim());
app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: '5mb' })); // headroom for .sql imports
app.use(morgan('dev'));

// --- Public routes (no auth) ---
// Health is intentionally open so the frontend can show connection
// status even on the login screen.
app.use('/api/health', healthRouter);
app.post('/api/auth/login', loginHandler);

// --- Everything below requires the dashboard password ---
app.use('/api', requireAuth);

// Stage 2 — Core Monitoring
app.use('/api/overview', overviewRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/database-stats', databaseRouter);

// Stage 3 — Query Tools
app.use('/api/query-performance', queriesRouter);
app.use('/api/sql', sqlRouter);

// Stage 4 — Backup Manager
app.use('/api/backup', backupRouter);

// Stage 5 — Insights & Explorer
app.use('/api/insights', insightsRouter);
app.use('/api/explorer', explorerRouter);

// Stage 6 — Recent Activity
app.use('/api/activity', activityRouter);

// AWS — RDS + CloudWatch monitoring
app.use('/api/cloud', cloudRouter);
app.use('/api/cost', costRouter);

// Automated health diagnostics
app.use('/api/diagnostics', diagnosticsRouter);
app.use('/api/locks', locksRouter);

// AI features (Gemini)
app.use('/api/ai', aiRouter);

// --- 404 + error handling ---
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`DBWatch backend listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
