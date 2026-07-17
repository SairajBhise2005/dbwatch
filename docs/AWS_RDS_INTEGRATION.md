# AWS RDS + CloudWatch Integration

This document describes the migration of DBWatch from a **self-managed
PostgreSQL on EC2** to **Amazon RDS for PostgreSQL**, and the new AWS-native
monitoring layer built on **CloudWatch**.

---

## 1. Summary of Changes

| Area | Before (self-managed) | After (RDS) |
|---|---|---|
| Database host | PostgreSQL on the EC2 host | Managed RDS instance (remote) |
| Backend → DB | `host.docker.internal` (Docker bridge) | RDS endpoint over TLS (`DB_SSL=true`) |
| Host metrics | Not available (only PG views) | **CloudWatch**: CPU, memory, storage, IOPS, latency, connections |
| Instance metadata | N/A | RDS `DescribeDBInstances` (class, storage, Multi-AZ…) |
| Tuning advice | PG-view insights only | PG insights **+ AWS Advisor** (cost/health from CloudWatch) |
| `pg_stat_statements` | `postgresql.conf` + restart | RDS **parameter group** + reboot |
| AWS auth | none | EC2 **IAM role** (CloudWatch + RDS read) |
| New page | — | **Cloud (RDS)** |

**Code changes:**
- `backend/aws.js` — AWS SDK v3 clients (CloudWatch + RDS), default credential chain.
- `backend/routes/cloud.js` — `/api/cloud/overview` and `/api/cloud/metrics`.
- `backend/.env.example` — `AWS_REGION`, `RDS_INSTANCE_ID`.
- `frontend/src/pages/Cloud.tsx` — the new Cloud page (summary, charts, advisor).
- `docker-compose.yml` — removed the `host.docker.internal` override so `DB_HOST`
  comes from `.env` (the RDS endpoint).

---

## 2. Architecture

**Before** — everything on one EC2 box:

```
Browser :80 → nginx → backend → (host.docker.internal) → PostgreSQL on EC2 host
```

**After** — backend on EC2, database managed by RDS, metrics from CloudWatch:

```
              Browser :80
                   │
                   ▼
        ┌──────────────────────┐         ┌──────────────────┐
        │  EC2 (Docker)        │  TLS    │  Amazon RDS       │
        │  nginx + backend     │ ──────▶ │  PostgreSQL 18    │
        │  (IAM role attached) │  5432   │  (private subnet) │
        └───────────┬──────────┘         └──────────────────┘
                    │ AWS SDK (IAM role)
                    ▼
        ┌──────────────────────┐
        │  CloudWatch / RDS API │  ← CPU, memory, storage, IOPS,
        │                       │    latency, connections, metadata
        └──────────────────────┘
```

The backend now talks to **two** AWS-managed services: RDS (the database, over
SQL/TLS) and CloudWatch + the RDS API (metrics/metadata, over the AWS SDK using
the instance's IAM role).

---

## 3. New Features (the "Cloud (RDS)" page)

- **Instance summary** — class, engine version, storage type/size, Multi-AZ,
  backup retention, Performance Insights status, live instance status.
- **Latest snapshot cards** — CPU %, connections (vs `max_connections`), free
  storage, freeable memory.
- **CloudWatch charts** — time series (selectable 1h/3h/12h/24h) for CPU,
  connections, free storage, freeable memory, IOPS (read/write), and latency
  (read/write).
- **AWS Advisor** — cost + health recommendations computed from CloudWatch +
  instance metadata (see §6).

### New API endpoints

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/cloud/overview` | Instance metadata + latest metric snapshot + recommendations |
| GET | `/api/cloud/metrics?minutes=N` | CloudWatch time series for the charts |

Both return `{ available: false, ... }` when AWS isn't configured, so the app
still runs without AWS.

---

## 4. Setup / Deployment Steps

### 4.1 Provision RDS (AWS Console, free tier)
- PostgreSQL, `db.t3.micro`/`db.t4g.micro`, 20 GB gp3, **same VPC** as EC2,
  **Public access = No**, initial database `internship_jusdb`, automated backups on.
- Turn on **Performance Insights** (free, 7-day retention).

### 4.2 Networking
- Edit the **RDS security group** → allow inbound **5432** with
  **Source = the EC2 instance's security group** (keeps RDS private).

### 4.3 Enable `pg_stat_statements`
- Create a **custom DB parameter group** (matching the engine family),
  set `shared_preload_libraries = pg_stat_statements`, attach it to the
  instance, and **reboot**.

### 4.4 IAM role for CloudWatch
- Create an IAM role for EC2 with **read-only** access to CloudWatch + RDS
  (e.g. `CloudWatchReadOnlyAccess` + `AmazonRDSReadOnlyAccess`), attach it to
  the EC2 instance. No keys are stored — the SDK's default credential chain
  picks it up automatically.

### 4.5 Migrate the database
From the EC2 box, copy `internship_jusdb` from the old Postgres into RDS:
```bash
pg_dump -h 127.0.0.1 -U postgres -Fc internship_jusdb -f /tmp/jusdb.dump
pg_restore -h <rds-endpoint> -U postgres -d internship_jusdb --no-owner /tmp/jusdb.dump
```

### 4.6 Create the read-only role + extension on RDS
```sql
-- connect: psql "host=<rds-endpoint> user=postgres dbname=internship_jusdb sslmode=require"
CREATE ROLE dbwatch WITH LOGIN PASSWORD '...';
GRANT pg_monitor TO dbwatch;                    -- rds_superuser can grant this
GRANT CONNECT ON DATABASE internship_jusdb TO dbwatch;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
GRANT USAGE ON SCHEMA public TO dbwatch;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbwatch;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbwatch;
```

### 4.7 Update `backend/.env` and redeploy
```
DB_HOST=<rds-endpoint>        # e.g. dbwatch-rds.xxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=dbwatch
DB_PASSWORD=...
DB_NAME=internship_jusdb
DB_ADMIN_USER=postgres
DB_ADMIN_PASSWORD=...
DB_SSL=true                   # RDS requires TLS
AWS_REGION=us-east-1
RDS_INSTANCE_ID=dbwatch-rds
```
```bash
git pull && sudo docker compose up -d --build
curl -s http://localhost/api/health          # connected:true
curl -s -H "x-dashboard-password: <pw>" http://localhost/api/cloud/overview
```

---

## 5. CloudWatch Metrics Used

All from the `AWS/RDS` namespace, dimensioned by `DBInstanceIdentifier`:

| Metric | Meaning |
|---|---|
| `CPUUtilization` | CPU % — drives right-sizing advice |
| `DatabaseConnections` | Active connections (vs `max_connections`) |
| `FreeableMemory` | RAM headroom |
| `FreeStorageSpace` | Disk headroom |
| `ReadIOPS` / `WriteIOPS` | I/O operations per second |
| `ReadLatency` / `WriteLatency` | Per-op latency (shown in ms) |

Fetched via a single `GetMetricData` call; period auto-scales with the selected
range (300s for ≤3h, up to 3600s for 24h).

---

## 6. AWS Advisor Recommendations

Computed in `routes/cloud.js` from CloudWatch + instance metadata:

| Trigger | Severity | Recommendation |
|---|---|---|
| Avg CPU < 20% and peak < 40% | Low | Over-provisioned — consider a smaller class (cost) |
| Avg CPU > 85% | High | Scale up / optimize top queries |
| Free storage < 15% | High | Enable storage autoscaling or increase storage |
| Freeable memory < 200 MB | Medium | Larger class or reduce `work_mem`/connections |
| Connections > 80% of `max_connections` | High | Add pooling (RDS Proxy / PgBouncer) |
| Read/Write latency > 20 ms | Medium | gp3 + provisioned IOPS, or query tuning |
| Single-AZ | Low | Enable Multi-AZ for auto-failover (prod) |
| Backups disabled | High | Enable automated backups for PITR |

---

## 7. Challenges Faced

- **No superuser / OS access.** RDS provides an `rds_superuser` master role, not
  a true superuser or shell. `pg_stat_statements` therefore can't be enabled by
  editing `postgresql.conf`; it required a **custom parameter group + reboot**.
- **TLS is mandatory.** RDS connections needed `DB_SSL=true`. `node-postgres`
  was configured with SSL; certificate verification is discussed in §8.
- **Compose `DB_HOST` override.** The old compose file forced
  `DB_HOST=host.docker.internal` for the on-host Postgres; this had to be removed
  so the RDS endpoint from `.env` is used.
- **Credentials without keys.** Rather than embedding IAM keys, we relied on the
  **EC2 instance role** via the SDK default credential chain — cleaner, but
  requires the role/policies to be attached before metrics appear (until then
  the page degrades gracefully to "not available").
- **Security group referencing.** RDS access is granted to the **EC2 security
  group** (not an IP), so it stays private and survives IP changes.
- **Metric granularity/latency.** CloudWatch RDS metrics arrive at ~60s
  intervals and can lag a minute or two, so the charts are near-real-time, not
  instantaneous.

---

## 8. Limitations Compared to a Self-Managed Database

| Capability | Self-managed (EC2) | RDS |
|---|---|---|
| OS / shell access | Full | **None** |
| Superuser | Yes | `rds_superuser` only (restricted) |
| Read PostgreSQL **log files** off disk | Yes | No — use RDS log download / CloudWatch Logs |
| Physical backup (`pg_basebackup`, PITR by hand) | Yes | Managed **snapshots** + automated PITR instead |
| Arbitrary extensions | Any | Only the **RDS-supported** list |
| Config changes | Edit `postgresql.conf` freely | **Parameter groups** only (some static params need reboot) |
| `pg_dump` logical backup | Yes | **Still works** (runs remotely from the EC2 backend) |
| Terminate backends | Yes | Yes (`rds_superuser` can `pg_terminate_backend`) |
| Host metrics (CPU/mem/disk) | Manual (e.g. node tools) | **Built-in via CloudWatch** ← a gain, not a loss |
| Cost | Cheaper (you manage it) | Higher — you pay for the managed service |
| Operational burden | High (patching, backups, HA) | Low (AWS-managed) |

**SSL note:** the backend currently connects with TLS but
`rejectUnauthorized: false` (encrypted, but the server certificate isn't
verified against the RDS CA). For full verification, download the RDS CA bundle,
mount it into the container, and configure `pg` with `ssl: { ca, rejectUnauthorized: true }`.

**Net trade-off:** RDS removes low-level control (no shell, no `postgresql.conf`,
no physical backups) but adds managed durability/HA and — most relevant to this
project — **first-class host-level observability via CloudWatch** that a
self-managed box didn't expose to the dashboard.

---

## 9. Concept Mapping (new work)

| Feature | AWS concept |
|---|---|
| RDS provisioning, parameter groups, security groups | Managed databases, VPC networking |
| CloudWatch metric charts | AWS monitoring / observability |
| AWS Advisor (right-sizing, storage, latency) | Cost optimization + health insights |
| IAM role on EC2 for the SDK | IAM, least-privilege, no static keys |
| RDS snapshots / automated backups | Managed backup & PITR |
| Migration via `pg_dump`/`pg_restore` | Logical backup portability |
