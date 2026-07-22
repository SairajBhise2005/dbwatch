// routes/cost.js — GET /api/cost/overview
// Cost Realization: estimated monthly bill + concrete up/down-scale
// recommendations, computed from a static RDS on-demand price table
// (no billing API required — deterministic and free). Prices are
// us-east-1 PostgreSQL single-AZ approximations; adjust REGION_MULT
// for other regions.

import { Router } from 'express';
import { awsConfigured, getInstanceInfo, getMetricSeries, getRdsCost } from '../aws.js';

const router = Router();
const HOURS_PER_MONTH = 730;
const STORAGE_GB_MONTH = 0.115; // gp3/gp2 $/GB-month (us-east-1 approx)

// On-demand $/hour, RDS PostgreSQL, single-AZ (us-east-1 approx).
const CLASS_HOURLY = {
  'db.t4g.micro': 0.016, 'db.t4g.small': 0.032, 'db.t4g.medium': 0.065, 'db.t4g.large': 0.129,
  'db.t3.micro': 0.018, 'db.t3.small': 0.036, 'db.t3.medium': 0.072, 'db.t3.large': 0.145,
  'db.m6g.large': 0.16, 'db.m6g.xlarge': 0.32,
  'db.m5.large': 0.178, 'db.m5.xlarge': 0.356,
};

// Ordered ladders so we can find the next-smaller / next-larger class.
const LADDERS = {
  't4g': ['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium', 'db.t4g.large'],
  't3': ['db.t3.micro', 'db.t3.small', 'db.t3.medium', 'db.t3.large'],
  'm6g': ['db.m6g.large', 'db.m6g.xlarge'],
  'm5': ['db.m5.large', 'db.m5.xlarge'],
};

function ladderFor(cls) {
  const fam = (cls || '').split('.')[1]; // db.<fam>.<size>
  return LADDERS[fam] || null;
}

const monthly = (hourly) => hourly * HOURS_PER_MONTH;
const round2 = (n) => Math.round(n * 100) / 100;

function avg(points) {
  const v = (points || []).map((p) => p.v).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function peak(points) {
  const v = (points || []).map((p) => p.v).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

router.get('/overview', async (_req, res, next) => {
  try {
    if (!awsConfigured()) {
      return res.json({
        available: false,
        message: 'AWS not configured — set AWS_REGION and RDS_INSTANCE_ID.',
      });
    }

    const [instance, series, billing] = await Promise.all([
      getInstanceInfo(),
      getMetricSeries(180),
      getRdsCost(),
    ]);

    if (!instance.available) {
      return res.json({ available: false, message: instance.reason });
    }

    const cls = instance.instanceClass;
    const hourly = CLASS_HOURLY[cls] ?? null;
    const storageGb = instance.allocatedStorageGb || 0;
    const storageCost = round2(storageGb * STORAGE_GB_MONTH);
    const instanceCost = hourly != null ? round2(monthly(hourly)) : null;
    const totalMonthly = instanceCost != null ? round2(instanceCost + storageCost) : null;

    // Scaling scenarios from the family ladder.
    const ladder = ladderFor(cls);
    const idx = ladder ? ladder.indexOf(cls) : -1;
    const scenarios = [];
    if (ladder && idx !== -1) {
      const mk = (targetCls, direction) => {
        const th = CLASS_HOURLY[targetCls];
        if (th == null) return;
        const tMonthly = round2(monthly(th) + storageCost);
        scenarios.push({
          direction,
          instanceClass: targetCls,
          monthlyCost: tMonthly,
          deltaMonthly: totalMonthly != null ? round2(tMonthly - totalMonthly) : null,
        });
      };
      if (idx > 0) mk(ladder[idx - 1], 'downscale');
      if (idx < ladder.length - 1) mk(ladder[idx + 1], 'upscale');
    }

    // Recommendation from CloudWatch CPU + memory signals.
    const m = series.available ? series.metrics : {};
    const avgCpu = avg(m.cpu?.points);
    const peakCpu = peak(m.cpu?.points);
    const lowMem = (() => {
      const last = (m.freeMemory?.points || []).filter((p) => p.v != null).at(-1);
      return last ? last.v < 200 * 1024 ** 2 : false;
    })();

    let recommendation = {
      action: 'right-sized',
      rationale: 'Utilization is within a healthy band — no change recommended.',
      targetClass: cls,
      monthlyDelta: 0,
    };
    const smaller = scenarios.find((s) => s.direction === 'downscale');
    const larger = scenarios.find((s) => s.direction === 'upscale');

    if (avgCpu != null && avgCpu < 20 && (peakCpu ?? 0) < 40 && smaller) {
      recommendation = {
        action: 'downscale',
        rationale: `Average CPU ${avgCpu.toFixed(1)}% (peak ${(peakCpu ?? 0).toFixed(1)}%) — over-provisioned.`,
        targetClass: smaller.instanceClass,
        monthlyDelta: smaller.deltaMonthly,
      };
    } else if (((avgCpu != null && avgCpu > 85) || (lowMem && avgCpu != null && avgCpu > 60)) && larger) {
      // Low freeable memory is only "pressure" under real load — on an idle
      // instance it's just cache using RAM, so we don't upscale for it.
      recommendation = {
        action: 'upscale',
        rationale:
          avgCpu != null && avgCpu > 85
            ? `Average CPU ${avgCpu.toFixed(1)}% — sustained high load.`
            : 'Freeable memory is low under load — more RAM recommended.',
        targetClass: larger.instanceClass,
        monthlyDelta: larger.deltaMonthly,
      };
    }

    // Additional savings recommendations (idle, storage, Reserved Instance),
    // each with an estimated $ impact. Metric-based ones are skipped when the
    // CloudWatch series is unavailable.
    const recommendations = [];
    let rid = 0;
    const addRec = (severity, category, detail, recommendation, monthlySavings) =>
      recommendations.push({ id: ++rid, severity, category, detail, recommendation, monthlySavings });

    const avgConns = avg(m.connections?.points);
    const lastFreeStorage = (m.freeStorage?.points || []).filter((p) => p.v != null).at(-1)?.v ?? null;

    // Idle instance — almost no connections and very low CPU.
    if (avgConns != null && avgCpu != null && avgConns < 1 && avgCpu < 10 && instanceCost != null) {
      addRec(
        'Medium',
        'Idle instance',
        `Avg ${avgConns.toFixed(1)} connections and ${avgCpu.toFixed(1)}% CPU — the instance looks idle.`,
        'Stop or delete it if unused; you pay for the instance even when idle.',
        instanceCost
      );
    }

    // Storage over-provisioning — lots of unused allocated storage.
    if (lastFreeStorage != null && storageGb) {
      const totalBytes = storageGb * 1024 ** 3;
      const freePct = (lastFreeStorage / totalBytes) * 100;
      const unusedGb = lastFreeStorage / 1024 ** 3;
      if (freePct > 70 && storageGb > 20) {
        addRec(
          'Low',
          'Storage over-provisioned',
          `~${unusedGb.toFixed(1)} GB of ${storageGb} GB is free (${freePct.toFixed(0)}%).`,
          'RDS storage cannot shrink — right-size allocation at the next migration/restore.',
          round2(unusedGb * STORAGE_GB_MONTH)
        );
      }
    }

    // Reserved Instance — steady 24×7 workloads save ~35% vs on-demand.
    if (instanceCost != null) {
      addRec(
        'Low',
        'Reserved Instance',
        `Steady usage on ${cls} at ~$${instanceCost}/mo on-demand.`,
        'A 1-year Reserved Instance / Savings Plan typically saves ~35% for always-on databases.',
        round2(instanceCost * 0.35)
      );
    }

    res.json({
      available: true,
      currency: 'USD',
      // Real billed spend from Cost Explorer (service-level RDS); may be
      // { available:false } if CE isn't enabled / IAM lacks ce:* perms.
      billing: { source: 'cost-explorer', ...billing },
      recommendations,
      pricingNote: 'Estimated on-demand, single-AZ, us-east-1. Excludes data transfer, I/O, backups beyond free tier.',
      instance: { class: cls, storageGb, hourly },
      breakdown: { instanceCost, storageCost, totalMonthly },
      scenarios,
      recommendation,
      utilization: { avgCpu: avgCpu != null ? round2(avgCpu) : null, peakCpu: peakCpu != null ? round2(peakCpu) : null },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
