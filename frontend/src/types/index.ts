// Shared TypeScript interfaces mirroring backend JSON shapes.

export interface DbStatus {
  connected: boolean;
  version: string | null;
  database: string | null;
  serverTime: string | null;
  error: string | null;
}

export interface Health {
  service: string;
  uptimeSeconds: number;
  tunnel?: boolean;
  db: DbStatus;
}

export interface HealthCheck {
  ok: boolean;
  points: number;
}

export interface Overview {
  activeConnections: number;
  cacheHitRatio: number;
  commits: number;
  rollbacks: number;
  databaseSize: number;
  longestQuerySeconds: number;
  blockingSessions: number;
  deadTupleRatio: number;
  healthScore: number;
  checks: {
    cacheHit: HealthCheck;
    noBlocking: HealthCheck;
    noLongQueries: HealthCheck;
    lowDeadTuples: HealthCheck;
  };
}

export interface Session {
  pid: number;
  username: string | null;
  database: string | null;
  state: string | null;
  client: string | null;
  waitType: string | null;
  waitEvent: string | null;
  durationSeconds: number | null;
  stateSeconds: number | null;
  query: string;
}

export interface SessionsSummary {
  totalConnections: number;
  distinctUsers: number;
  active: number;
  idle: number;
  idleInTransaction: number;
  byState: Record<string, number>;
}

export interface SessionsResponse {
  sessions: Session[];
  count: number;
  summary: SessionsSummary;
}

export interface Lock {
  pid: number;
  username: string | null;
  database: string | null;
  locktype: string;
  mode: string;
  granted: boolean;
  relation: string | null;
  state: string | null;
  durationSeconds: number | null;
  query: string;
  blockedBy: number[];
}

export interface LocksResponse {
  locks: Lock[];
  total: number;
  waiting: number;
  blocked: number;
}

export type DiagStatus = 'ok' | 'warn' | 'fail';

export interface DiagnosticCheck {
  name: string;
  status: DiagStatus;
  detail: string;
}

export interface Diagnostics {
  overall: DiagStatus;
  summary: { ok: number; warn: number; fail: number };
  checks: DiagnosticCheck[];
}

export interface CostScenario {
  direction: 'downscale' | 'upscale';
  instanceClass: string;
  monthlyCost: number;
  deltaMonthly: number | null;
}

export interface CostBilling {
  available: boolean;
  source?: string;
  reason?: string;
  currency?: string;
  monthToDate?: number | null;
  lastMonth?: number | null;
  forecastMonthEnd?: number | null;
}

export interface CostOverview {
  available: boolean;
  message?: string;
  currency?: string;
  billing?: CostBilling;
  pricingNote?: string;
  instance?: { class: string; storageGb: number; hourly: number | null };
  breakdown?: { instanceCost: number | null; storageCost: number; totalMonthly: number | null };
  scenarios?: CostScenario[];
  recommendation?: {
    action: 'right-sized' | 'downscale' | 'upscale';
    rationale: string;
    targetClass: string;
    monthlyDelta: number | null;
  };
  utilization?: { avgCpu: number | null; peakCpu: number | null };
}

// ── AWS / RDS + CloudWatch ──
export interface CloudInstance {
  available: boolean;
  instanceId?: string;
  instanceClass?: string;
  engine?: string;
  engineVersion?: string;
  status?: string;
  allocatedStorageGb?: number;
  maxAllocatedStorageGb?: number | null;
  storageType?: string;
  multiAZ?: boolean;
  publiclyAccessible?: boolean;
  backupRetentionDays?: number;
  performanceInsights?: boolean;
  availabilityZone?: string;
  reason?: string;
}

export interface CloudLatest {
  cpu: number | null;
  connections: number | null;
  freeMemoryBytes: number | null;
  freeStorageBytes: number | null;
  readIops: number | null;
  writeIops: number | null;
  readLatencyMs: number | null;
  writeLatencyMs: number | null;
}

export interface CloudRecommendation {
  id: number;
  severity: 'High' | 'Medium' | 'Low';
  category: string;
  detail: string;
  recommendation: string;
}

export interface CloudOverview {
  available: boolean;
  message?: string;
  config?: { region: string; instanceId: string };
  instance?: CloudInstance;
  latest?: CloudLatest;
  maxConnections?: number | null;
  recommendations?: CloudRecommendation[];
}

export interface MetricPoint {
  t: string;
  v: number | null;
}

export interface MetricSeries {
  label: string;
  unit: string;
  points: MetricPoint[];
}

export interface CloudMetricsResponse {
  available: boolean;
  reason?: string;
  periodSeconds?: number;
  minutes?: number;
  metrics?: Record<string, MetricSeries>;
}

export interface Activity {
  pid: number;
  username: string | null;
  database: string | null;
  state: string | null;
  sinceSeconds: number | null;
  durationSeconds: number | null;
  waitType: string | null;
  waitEvent: string | null;
  query: string;
}

export interface ActivityResponse {
  activity: Activity[];
  count: number;
}

export type Severity = 'High' | 'Medium' | 'Low';

export interface Insight {
  id: number;
  category: string;
  severity: Severity;
  object: string;
  detail: string;
  recommendation: string;
}

export interface InsightsResponse {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    statementsAvailable: boolean;
  };
  insights: Insight[];
}

export interface ExplorerTable {
  schema: string;
  name: string;
  rowEstimate: number;
  sizeBytes: number;
  indexCount: number;
}

export interface ExplorerIndex {
  schema: string;
  table: string;
  name: string;
  sizeBytes: number;
  scans: number;
  isUnique: boolean;
  isPrimary: boolean;
}

export interface ExplorerView {
  schema: string;
  name: string;
}

export interface ExplorerRole {
  name: string;
  canLogin: boolean;
  isSuperuser: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
}

export interface ExplorerData {
  database: string;
  tables: ExplorerTable[];
  views: ExplorerView[];
  indexes: ExplorerIndex[];
  roles: ExplorerRole[];
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
}

export interface TableDetail {
  schema: string;
  name: string;
  sizeBytes: number;
  rowEstimate: number;
  columns: TableColumn[];
  indexes: { name: string; definition: string }[];
}

export interface Backup {
  filename: string;
  size: number;
  mtimeMs: number;
  createdAt: string;
}

export interface BackupListResponse {
  backups: Backup[];
  inProgress: boolean;
  retention: { keepCount: number; keepDays: number };
}

export interface QueryStat {
  queryid: string | null;
  query: string;
  calls: number;
  totalTime: number;
  meanTime: number;
  minTime: number;
  maxTime: number;
  stddevTime: number;
  rows: number;
}

export interface QueryPerformanceResponse {
  available: boolean;
  message?: string;
  statements: QueryStat[];
}

export interface SqlExecuteResult {
  command: string;
  rowCount: number | null;
  fields: string[];
  rows: Record<string, unknown>[];
  limitApplied: number | null;
}

export interface SqlPlanResult {
  plan: string;
}

export interface DatabaseStats {
  commits: number;
  rollbacks: number;
  blocksRead: number;
  blocksHit: number;
  rowsReturned: number;
  rowsFetched: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsDeleted: number;
  conflicts: number;
  deadlocks: number;
  tempFiles: number;
  tempBytes: number;
  cacheHitRatio: number;
}
