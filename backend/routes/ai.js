// routes/ai.js — AI features backed by Gemini (server-side proxy so the
// API key never reaches the browser). All endpoints degrade to
// { available:false } when GEMINI_API_KEY is unset.
//   GET  /api/ai/status          — is AI configured?
//   POST /api/ai/optimize-query  — analyze SQL (+ EXPLAIN) → suggestions
//   POST /api/ai/diagnose        — health diagnostics → remediation advice

import { Router } from 'express';
import { monitorPool } from '../db.js';
import { geminiConfigured, generate, parseJson } from '../gemini.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json({ available: geminiConfigured() });
});

router.post('/optimize-query', async (req, res) => {
  const sql = String(req.body?.sql || '').trim().replace(/;\s*$/, '');
  if (!sql) return res.status(400).json({ error: 'No SQL provided' });
  if (!geminiConfigured()) {
    return res.json({ available: false, reason: 'GEMINI_API_KEY not set' });
  }

  // Grab the plan for context (EXPLAIN doesn't execute; safe on the
  // read-only pool). Best-effort — proceed without it on failure.
  let plan = '';
  try {
    const r = await monitorPool.query(`EXPLAIN ${sql}`);
    plan = r.rows.map((row) => row['QUERY PLAN']).join('\n');
  } catch {
    /* invalid query or no plan — continue without it */
  }

  const system =
    'You are a PostgreSQL performance expert. Given a SQL query and (optionally) ' +
    'its EXPLAIN plan, find inefficiencies and propose improvements. Respond ONLY ' +
    'with JSON of shape: {"summary": string, "optimizedSql": string|null, ' +
    '"indexes": string[] (CREATE INDEX statements), "notes": string[]}. ' +
    'Keep optimizedSql semantically equivalent; use null if no rewrite helps.';
  const prompt = `Query:\n${sql}\n\nEXPLAIN plan:\n${plan || '(unavailable)'}`;

  const out = await generate(prompt, { system, json: true, maxTokens: 2048 });
  if (!out.available) return res.json({ available: false, reason: out.reason });

  const parsed = parseJson(out.text);
  if (!parsed) return res.json({ available: true, raw: out.text });
  res.json({ available: true, plan, ...parsed });
});

router.post('/diagnose', async (req, res) => {
  if (!geminiConfigured()) {
    return res.json({ available: false, reason: 'GEMINI_API_KEY not set' });
  }
  const payload = {
    diagnostics: req.body?.diagnostics ?? null,
    metrics: req.body?.metrics ?? null,
  };
  if (!payload.diagnostics) return res.status(400).json({ error: 'No diagnostics provided' });

  const system =
    'You are a senior PostgreSQL DBA. Given automated health-check results and ' +
    'metrics, give prioritized, concrete remediation steps a developer can act on. ' +
    'Be specific and brief. Respond ONLY with JSON: {"summary": string, ' +
    '"actions": [{"title": string, "detail": string}]}.';
  const prompt = JSON.stringify(payload);

  const out = await generate(prompt, { system, json: true, maxTokens: 1536 });
  if (!out.available) return res.json({ available: false, reason: out.reason });

  const parsed = parseJson(out.text);
  if (!parsed) return res.json({ available: true, raw: out.text });
  res.json({ available: true, ...parsed });
});

export default router;
