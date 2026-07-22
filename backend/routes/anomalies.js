// routes/anomalies.js — GET /api/anomalies?minutes=N
// Runs the robust statistical detector (anomaly.js) over each CloudWatch
// metric series and returns the flagged points per metric. Requires AWS
// (CloudWatch) — degrades to { available:false } otherwise.

import { Router } from 'express';
import { awsConfigured, getMetricSeries } from '../aws.js';
import { detectAnomalies } from '../anomaly.js';

const router = Router();

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

    const results = [];
    let totalAnomalies = 0;
    for (const [key, m] of Object.entries(series.metrics)) {
      const { baseline, anomalies } = detectAnomalies(m.points);
      totalAnomalies += anomalies.length;
      results.push({ key, label: m.label, unit: m.unit, baseline, anomalies });
    }
    // Most-anomalous metrics first.
    results.sort((a, b) => b.anomalies.length - a.anomalies.length);

    res.json({
      available: true,
      minutes,
      method: 'Modified z-score (median + MAD), threshold 3.5',
      totalAnomalies,
      results,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
