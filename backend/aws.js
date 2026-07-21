// aws.js — AWS integration for RDS monitoring.
//
// Uses the AWS SDK v3 default credential chain, so on EC2 it picks up
// the attached IAM role automatically (no keys in .env). Two clients:
//   • CloudWatch — host-level RDS metrics (CPU, memory, storage, IOPS…)
//   • RDS        — instance metadata (class, storage, engine, Multi-AZ)
//
// Everything degrades gracefully: if AWS_REGION / RDS_INSTANCE_ID are
// unset or a call fails, callers get { available:false, ... } instead
// of an exception, so the dashboard still works without AWS configured.

import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostForecastCommand,
} from '@aws-sdk/client-cost-explorer';

const REGION = process.env.AWS_REGION || '';
const INSTANCE_ID = process.env.RDS_INSTANCE_ID || '';

export function awsConfigured() {
  return Boolean(REGION && INSTANCE_ID);
}

export function awsConfig() {
  return { region: REGION, instanceId: INSTANCE_ID };
}

let _cw = null;
let _rds = null;
let _ce = null;
function cw() {
  if (!_cw) _cw = new CloudWatchClient({ region: REGION });
  return _cw;
}
function rds() {
  if (!_rds) _rds = new RDSClient({ region: REGION });
  return _rds;
}
function ce() {
  // Cost Explorer is a global service; its endpoint lives in us-east-1
  // regardless of where the RDS instance runs.
  if (!_ce) _ce = new CostExplorerClient({ region: 'us-east-1' });
  return _ce;
}

const RDS_SERVICE = 'Amazon Relational Database Service';
const RDS_FILTER = { Dimensions: { Key: 'SERVICE', Values: [RDS_SERVICE] } };

// The CloudWatch metrics we chart. `stat` + `unit` drive the frontend.
export const METRICS = [
  { key: 'cpu', name: 'CPUUtilization', stat: 'Average', unit: 'Percent', label: 'CPU utilization' },
  { key: 'connections', name: 'DatabaseConnections', stat: 'Average', unit: 'Count', label: 'DB connections' },
  { key: 'freeMemory', name: 'FreeableMemory', stat: 'Average', unit: 'Bytes', label: 'Freeable memory' },
  { key: 'freeStorage', name: 'FreeStorageSpace', stat: 'Average', unit: 'Bytes', label: 'Free storage' },
  { key: 'readIops', name: 'ReadIOPS', stat: 'Average', unit: 'Count/Second', label: 'Read IOPS' },
  { key: 'writeIops', name: 'WriteIOPS', stat: 'Average', unit: 'Count/Second', label: 'Write IOPS' },
  { key: 'readLatency', name: 'ReadLatency', stat: 'Average', unit: 'Seconds', label: 'Read latency' },
  { key: 'writeLatency', name: 'WriteLatency', stat: 'Average', unit: 'Seconds', label: 'Write latency' },
  { key: 'readThroughput', name: 'ReadThroughput', stat: 'Average', unit: 'Bytes/Second', label: 'Read throughput' },
  { key: 'writeThroughput', name: 'WriteThroughput', stat: 'Average', unit: 'Bytes/Second', label: 'Write throughput' },
  { key: 'netRx', name: 'NetworkReceiveThroughput', stat: 'Average', unit: 'Bytes/Second', label: 'Network in' },
  { key: 'netTx', name: 'NetworkTransmitThroughput', stat: 'Average', unit: 'Bytes/Second', label: 'Network out' },
  { key: 'diskQueue', name: 'DiskQueueDepth', stat: 'Average', unit: 'Count', label: 'Disk queue depth' },
  { key: 'swap', name: 'SwapUsage', stat: 'Average', unit: 'Bytes', label: 'Swap usage' },
  { key: 'cpuCredits', name: 'CPUCreditBalance', stat: 'Average', unit: 'Count', label: 'CPU credit balance' },
];

/**
 * Fetch a time series for each metric over the last `minutes`.
 * Returns { available, metrics: { key: { label, unit, points:[{t,v}] } } }.
 */
export async function getMetricSeries(minutes = 180) {
  if (!awsConfigured()) {
    return { available: false, reason: 'AWS_REGION / RDS_INSTANCE_ID not set' };
  }
  // Choose a period that keeps ~data points reasonable (min 60s).
  const period = minutes <= 180 ? 300 : minutes <= 720 ? 900 : 3600;
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60_000);

  const queries = METRICS.map((m, i) => ({
    Id: `m${i}`,
    MetricStat: {
      Metric: {
        Namespace: 'AWS/RDS',
        MetricName: m.name,
        Dimensions: [{ Name: 'DBInstanceIdentifier', Value: INSTANCE_ID }],
      },
      Period: period,
      Stat: m.stat,
    },
    ReturnData: true,
  }));

  try {
    const out = await cw().send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: start,
        EndTime: end,
        ScanBy: 'TimestampAscending',
      })
    );

    const metrics = {};
    (out.MetricDataResults || []).forEach((res) => {
      const idx = Number(String(res.Id).replace('m', ''));
      const meta = METRICS[idx];
      if (!meta) return;
      const ts = res.Timestamps || [];
      const vals = res.Values || [];
      metrics[meta.key] = {
        label: meta.label,
        unit: meta.unit,
        points: ts.map((t, i) => ({ t: new Date(t).toISOString(), v: vals[i] })),
      };
    });

    return { available: true, periodSeconds: period, minutes, metrics };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Describe the RDS instance (class, storage, engine, Multi-AZ, status).
 */
export async function getInstanceInfo() {
  if (!awsConfigured()) {
    return { available: false, reason: 'AWS_REGION / RDS_INSTANCE_ID not set' };
  }
  try {
    const out = await rds().send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: INSTANCE_ID })
    );
    const db = (out.DBInstances || [])[0];
    if (!db) return { available: false, reason: 'Instance not found' };
    return {
      available: true,
      instanceId: db.DBInstanceIdentifier,
      instanceClass: db.DBInstanceClass,
      engine: db.Engine,
      engineVersion: db.EngineVersion,
      status: db.DBInstanceStatus,
      allocatedStorageGb: db.AllocatedStorage,
      maxAllocatedStorageGb: db.MaxAllocatedStorage || null,
      storageType: db.StorageType,
      multiAZ: db.MultiAZ,
      publiclyAccessible: db.PubliclyAccessible,
      backupRetentionDays: db.BackupRetentionPeriod,
      performanceInsights: Boolean(db.PerformanceInsightsEnabled),
      availabilityZone: db.AvailabilityZone,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

// ── Real billing via Cost Explorer ──────────────────────────────
// Returns actual RDS spend (service-level): month-to-date, last month,
// and a projected month-end total (MTD + forecast of the remainder).
// Cached 6h — CE bills ~$0.01/call and the page polls every 60s.
// ponytail: global 6h cache; make it per-window only if this ever grows.
let _costCache = null;
const COST_TTL_MS = 6 * 60 * 60 * 1000;
const isoDay = (d) => d.toISOString().slice(0, 10);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

export async function getRdsCost() {
  if (!awsConfigured()) {
    return { available: false, reason: 'AWS_REGION / RDS_INSTANCE_ID not set' };
  }
  if (_costCache && Date.now() - _costCache.ts < COST_TTL_MS) return _costCache.data;

  try {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const thisMonthStart = new Date(Date.UTC(y, m, 1));
    const lastMonthStart = new Date(Date.UTC(y, m - 1, 1));
    const nextMonthStart = new Date(Date.UTC(y, m + 1, 1));
    const today = new Date(Date.UTC(y, m, now.getUTCDate()));

    // Actual: last full month + month-to-date (two monthly buckets).
    const usage = await ce().send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: isoDay(lastMonthStart), End: isoDay(today) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        Filter: RDS_FILTER,
      })
    );
    const buckets = usage.ResultsByTime || [];
    const amt = (b) => Number(b?.Total?.UnblendedCost?.Amount ?? 0);
    let monthToDate = null;
    let lastMonth = null;
    let currency = 'USD';
    for (const b of buckets) {
      const start = b.TimePeriod?.Start;
      currency = b.Total?.UnblendedCost?.Unit || currency;
      if (start === isoDay(thisMonthStart)) monthToDate = amt(b);
      else if (start === isoDay(lastMonthStart)) lastMonth = amt(b);
    }

    // Forecast the remainder of the month, then project the full total.
    let forecastMonthEnd = null;
    try {
      if (isoDay(today) !== isoDay(nextMonthStart)) {
        const fc = await ce().send(
          new GetCostForecastCommand({
            TimePeriod: { Start: isoDay(today), End: isoDay(nextMonthStart) },
            Metric: 'UNBLENDED_COST',
            Granularity: 'MONTHLY',
            Filter: RDS_FILTER,
          })
        );
        const remainder = fc.Total?.Amount != null ? Number(fc.Total.Amount) : null;
        if (remainder != null) forecastMonthEnd = (monthToDate ?? 0) + remainder;
      }
    } catch {
      /* forecast needs some history / valid future window — leave null */
    }

    const data = {
      available: true,
      currency,
      monthToDate: round2(monthToDate),
      lastMonth: round2(lastMonth),
      forecastMonthEnd: round2(forecastMonthEnd),
    };
    _costCache = { ts: Date.now(), data };
    return data;
  } catch (err) {
    // Negative-cache the failure briefly so a missing permission / disabled
    // Cost Explorer doesn't get retried on every poll.
    const data = { available: false, reason: err.message };
    _costCache = { ts: Date.now(), data };
    return data;
  }
}
