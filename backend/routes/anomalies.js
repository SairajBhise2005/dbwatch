// routes/anomalies.js — GET /api/anomalies?minutes=N
//
// PRIMARY: multivariate Isolation Forest via the Python sidecar
// (anomaly-service) — the model the benchmark picked for our data
// (docs/ANOMALY_MODEL_BENCHMARK.md). It scores each timestamp across ALL
// metrics at once, catching odd metric *combinations*.
// FALLBACK: if the sidecar is down/slow, the built-in modified z-score
// (anomaly.js) runs per-metric and its flags are grouped by timestamp —
// so anomaly detection degrades gracefully and the page always works.
//
// Both engines return the same shape:
//   anomalies: [{ t, score, contributors: [{ key, label, value, z }] }]

import { Router } from 'express';
import { awsConfigured, getMetricSeries, METRICS } from '../aws.js';
import { detectAnomalies } from '../anomaly.js';

const router = Router();

const SERVICE_URL = process.env.ANOMALY_SERVICE_URL || 'http://anomaly-service:8000';
const LABELS = Object.fromEntries(METRICS.map((m) => [m.key, m.label]));

// Operational noise floors per metric (used by the z-score fallback): a
// deviation smaller than this isn't worth flagging even if statistically
// unusual (a near-idle metric jittering around zero).
const FLOORS = {
  readLatency: 0.02, // 20 ms
  writeLatency: 0.02,
  diskQueue: 1,
  readIops: 10,
  writeIops: 10,
};

// Ask the Isolation Forest sidecar to score the series. Resolves to a
// normalized anomalies[] or null (unavailable → caller falls back).
async function isolationForest(series) {
  try {
    const r = await fetch(`${SERVICE_URL}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metrics: series.metrics, contamination: 0.05 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.available) return null;
    const anomalies = (d.anomalies || []).map((a) => ({
      t: a.t,
      score: a.score,
      contributors: (a.contributors || []).map((c) => ({ ...c, label: LABELS[c.key] || c.key })),
    }));
    return { engine: 'isolation-forest', method: 'Isolation Forest (multivariate)', anomalies };
  } catch {
    return null; // network error / timeout → fallback
  }
}

// Fallback: per-metric modified z-score, flags grouped by timestamp so the
// output matches the multivariate shape.
function zscoreFallback(series) {
  const byTime = new Map();
  for (const [key, m] of Object.entries(series.metrics)) {
    const { anomalies } = detectAnomalies(m.points, { minAbsDev: FLOORS[key] || 0 });
    for (const a of anomalies) {
      const e = byTime.get(a.t) || { t: a.t, score: 0, contributors: [] };
      e.contributors.push({ key, label: m.label, value: a.v, z: a.score });
      e.score = Math.max(e.score, Math.abs(a.score));
      byTime.set(a.t, e);
    }
  }
  const anomalies = [...byTime.values()].sort((a, b) => b.score - a.score);
  return {
    engine: 'zscore',
    method: 'Modified z-score (median + MAD) — fallback',
    anomalies,
  };
}

router.get('/', async (req, res, next) => {
  try {
    if (!awsConfigured()) {
      return res.json({
        available: false,
        reason: 'AWS not configured — anomaly detection runs on CloudWatch metrics.',
      });
    }
    const minutes = Math.min(Math.max(Number(req.query.minutes) || 180, 60), 1440);
    const series = await getMetricSeries(minutes);
    if (!series.available) return res.json({ available: false, reason: series.reason });

    const primary = await isolationForest(series);
    const result = primary || zscoreFallback(series);

    res.json({
      available: true,
      minutes,
      engine: result.engine,
      method: result.method,
      degraded: !primary, // true when the sidecar was unreachable
      totalAnomalies: result.anomalies.length,
      anomalies: result.anomalies,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
