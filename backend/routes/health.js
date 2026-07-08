// routes/health.js — connection status + server version.
// Maps to the "connection status banner" in Stage 1.

import { Router } from 'express';
import { checkConnection } from '../db.js';

const router = Router();

// GET /api/health
router.get('/', async (_req, res) => {
  const status = await checkConnection();
  res.status(status.connected ? 200 : 503).json({
    service: 'dbwatch-backend',
    uptimeSeconds: Math.round(process.uptime()),
    db: status,
  });
});

export default router;
