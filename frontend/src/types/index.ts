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

export interface SessionsResponse {
  sessions: Session[];
  count: number;
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
