// routes/cloud.js — AWS-native monitoring for the RDS instance.
//   GET /api/cloud/overview          — instance metadata + latest metric
//                                       snapshot + AWS advisor recommendations
//   GET /api/cloud/metrics?minutes=N — CloudWatch time series for charts
//
// All AWS calls degrade gracefully (see aws.js). When AWS isn't
// configured the endpoints return { available:false } and the UI shows
// a "not configured" state rather than erroring.

import { Router } from 'express';
import { monitorPool } from '../db.js';
import {
  awsConfigured,
  awsConfig,
  getMetricSeries,
  getInstanceInfo,
} from '../aws.js';

const router = Router();

const lastVal = (pts) => {
  for (let i = (pts?.length || 0) - 1; i >= 0; i--) {
    if (pts[i].v !== null && pts[i].v !== undefined) return pts[i].v;
  }
  return null;
};
const avgVal = (pts) => {
  const vals = (pts || []).map((p) => p.v).filter((v) => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};

router.get('/metrics', async (req, res, next) => {
  try {
    const minutes = Math.min(Math.max(Number(req.query.minutes) || 180, 15), 1440);
    res.json(await getMetricSeries(minutes));
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (_req, res, next) => {
  try {
    if (!awsConfigured()) {
      return res.json({
        available: false,
        message:
          'AWS integration not configured. Set AWS_REGION and RDS_INSTANCE_ID, ' +
          'and attach an IAM role with CloudWatch + RDS read access to the EC2 instance.',
        config: awsConfig(),
      });
    }

    const [instance, series, maxConnRow] = await Promise.all([
      getInstanceInfo(),
      getMetricSeries(60),
      monitorPool
        .query(`SELECT setting::int AS max FROM pg_settings WHERE name='max_connections'`)
        .catch(() => ({ rows: [{ max: null }] })),
    ]);

    const maxConnections = maxConnRow.rows[0]?.max ?? null;
    const m = series.available ? series.metrics : {};

    const latest = {
      cpu: lastVal(m.cpu?.points),
      connections: lastVal(m.connections?.points),
      freeMemoryBytes: lastVal(m.freeMemory?.points),
      freeStorageBytes: lastVal(m.freeStorage?.points),
      readIops: lastVal(m.readIops?.points),
      writeIops: lastVal(m.writeIops?.points),
      readLatencyMs: mult(lastVal(m.readLatency?.points), 1000),
      writeLatencyMs: mult(lastVal(m.writeLatency?.points), 1000),
    };

    const recommendations = buildRecommendations({
      instance,
      series: m,
      latest,
      maxConnections,
    });

    res.json({
      available: true,
      config: awsConfig(),
      instance,
      latest,
      maxConnections,
      recommendations,
    });
  } catch (err) {
    next(err);
  }
});

function mult(v, f) {
  return v === null || v === undefined ? null : v * f;
}

// AWS Advisor: cost + health recommendations from CloudWatch + RDS metadata.
function buildRecommendations({ instance, series, latest, maxConnections }) {
  const recs = [];
  let id = 0;
  const add = (severity, category, detail, recommendation) =>
    recs.push({ id: ++id, severity, category, detail, recommendation });

  const avgCpu = avgVal(series.cpu?.points);
  const maxCpu = Math.max(...((series.cpu?.points || []).map((p) => p.v ?? 0)), 0);

  // --- Cost: over-provisioned CPU ---
  if (avgCpu !== null && avgCpu < 20 && maxCpu < 40) {
    add(
      'Low',
      'Cost optimization',
      `Average CPU is ${avgCpu.toFixed(1)}% (peak ${maxCpu.toFixed(1)}%) over the last hour on ${instance.instanceClass || 'this instance'}.`,
      'Instance appears over-provisioned — consider a smaller class to reduce cost.'
    );
  }
  // --- Health: CPU saturation ---
  if (avgCpu !== null && avgCpu > 85) {
    add(
      'High',
      'CPU saturation',
      `Average CPU is ${avgCpu.toFixed(1)}% — sustained high utilization.`,
      'Consider scaling up the instance class or optimizing top queries.'
    );
  }

  // --- Storage headroom ---
  if (latest.freeStorageBytes !== null && instance.allocatedStorageGb) {
    const totalBytes = instance.allocatedStorageGb * 1024 ** 3;
    const freePct = (latest.freeStorageBytes / totalBytes) * 100;
    if (freePct < 15) {
      add(
        'High',
        'Storage pressure',
        `Only ${freePct.toFixed(1)}% free storage remaining (${(latest.freeStorageBytes / 1024 ** 3).toFixed(1)} GB of ${instance.allocatedStorageGb} GB).`,
        instance.maxAllocatedStorageGb
          ? 'Storage autoscaling is enabled — monitor growth.'
          : 'Enable storage autoscaling or increase allocated storage.'
      );
    }
  }

  // --- Memory pressure (only under load; low freeable memory on an idle
  //     instance is just cache using RAM, not pressure) ---
  if (
    latest.freeMemoryBytes !== null &&
    latest.freeMemoryBytes < 200 * 1024 ** 2 &&
    avgCpu !== null &&
    avgCpu > 60
  ) {
    add(
      'Medium',
      'Memory pressure',
      `Freeable memory is low (${(latest.freeMemoryBytes / 1024 ** 2).toFixed(0)} MB) under sustained load.`,
      'Consider a larger instance class or reducing work_mem / connection count.'
    );
  }

  // --- Connection pressure ---
  if (latest.connections !== null && maxConnections) {
    const pct = (latest.connections / maxConnections) * 100;
    if (pct > 80) {
      add(
        'High',
        'Connection pressure',
        `${Math.round(latest.connections)} of ${maxConnections} connections in use (${pct.toFixed(0)}%).`,
        'Introduce connection pooling (e.g. RDS Proxy / PgBouncer) or raise max_connections.'
      );
    }
  }

  // --- I/O latency ---
  const rLat = latest.readLatencyMs;
  const wLat = latest.writeLatencyMs;
  if ((rLat !== null && rLat > 20) || (wLat !== null && wLat > 20)) {
    add(
      'Medium',
      'I/O latency',
      `Read ${rLat?.toFixed(1) ?? '—'} ms / write ${wLat?.toFixed(1) ?? '—'} ms.`,
      'Consider gp3 with provisioned IOPS, or investigate heavy queries.'
    );
  }

  // --- Resilience / config notes ---
  if (instance.available && instance.multiAZ === false) {
    add(
      'Low',
      'Resilience',
      'Instance is Single-AZ — no automatic failover.',
      'For production, enable Multi-AZ (adds cost, adds a standby + auto-failover).'
    );
  }
  if (instance.available && instance.backupRetentionDays === 0) {
    add(
      'High',
      'Backups disabled',
      'Automated backups are turned off (retention = 0 days).',
      'Enable automated backups to allow point-in-time recovery.'
    );
  }

  return recs;
}

export default router;
