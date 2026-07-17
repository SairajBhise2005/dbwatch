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
function cw() {
  if (!_cw) _cw = new CloudWatchClient({ region: REGION });
  return _cw;
}
function rds() {
  if (!_rds) _rds = new RDSClient({ region: REGION });
  return _rds;
}

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
