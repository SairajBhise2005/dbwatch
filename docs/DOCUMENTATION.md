# DBWatch — Complete Project Documentation

A deep-dive into every part of DBWatch: what it is, how it's built, how it's
deployed, and exactly what each page and API endpoint does.

> For a quick start, see the [README](../README.md). This document is the full
> reference.

---

## Table of Contents

1. [What DBWatch Is](#1-what-dbwatch-is)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Security Model](#4-security-model)
5. [The Nine Pages](#5-the-nine-pages)
6. [API Reference](#6-api-reference)
7. [Configuration (.env)](#7-configuration-env)
8. [Deployment](#8-deployment)
9. [Local Development](#9-local-development)
10. [Project Structure](#10-project-structure)
11. [Internship Concept Mapping](#11-internship-concept-mapping)

---

## 1. What DBWatch Is

DBWatch is a self-hosted **PostgreSQL monitoring and administration dashboard** —
a lightweight blend of pgAdmin and Grafana, focused on observability, query
analysis, backups, and tuning insights. It connects to a PostgreSQL instance
running on AWS EC2 and presents nine pages of live, auto-refreshing data.

The design principle throughout: **monitoring is read-only and safe**. The only
operations that can change the database are ones you trigger manually and
knowingly (running SQL in the editor, terminating a session, taking a backup).

---

## 2. Architecture

Unlike a split frontend/backend hosting model, DBWatch runs **entirely on the
EC2 instance** alongside PostgreSQL, in Docker containers. This lets the backend
reach the database over the host's internal network (port 5432 is never exposed
to the internet) and run local tools like `pg_dump`.

```
                        Browser (any device)
                              │  HTTP :80
                              ▼
        ┌─────────────────────────────────────────┐  AWS EC2 (Ubuntu)
        │  Docker network                          │
        │                                          │
        │   ┌────────────────┐   /api    ┌───────┐ │
        │   │  frontend       │ ────────▶ │backend│ │
        │   │  nginx + React  │  proxy    │ Node  │ │
        │   │  (port 80)      │           │ :3001 │ │
        │   └────────────────┘           └───┬───┘ │
        │                                    │      │
        └────────────────────────────────────┼──────┘
                                             │ node-postgres (TCP)
                                   host.docker.internal
                                             │
                                   ┌─────────▼─────────┐
                                   │  PostgreSQL 18    │
                                   │  (on the EC2 host)│
                                   └───────────────────┘
```

**Request flow:** the browser hits nginx on port 80. nginx serves the compiled
React SPA and reverse-proxies any `/api/*` request to the backend container.
The backend queries PostgreSQL on the host via `host.docker.internal` (mapped to
the Docker bridge gateway). Because the frontend and API are same-origin, there
is no CORS complexity in production.

**Why this beats a Vercel/Render split:** the backend is co-located with
PostgreSQL, so it can run `pg_dump` for real backups, connect over a private
interface, and never requires opening port 5432 to the world. Only port 80 is
public.

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | React 18 + TypeScript | Component-based, type-safe |
| Build tool | Vite | Fast dev server + optimized production build |
| Styling | Tailwind CSS v4 | Utility-first; CSS-variable theming for dark/light |
| Charts | Recharts | Native React charting (cache-hit line chart) |
| Icons | lucide-react | Clean, consistent icon set |
| Routing | React Router v7 | Client-side routing for the 9 pages |
| Backend | Node.js + Express | Simple, huge ecosystem |
| DB driver | node-postgres (`pg`) | Official PostgreSQL driver |
| Web server / proxy | nginx | Serves the SPA + proxies `/api` |
| Containerization | Docker + Docker Compose | Reproducible deploy on EC2 |
| Database | PostgreSQL 18 (on EC2) | The monitored instance |

---

## 4. Security Model

DBWatch is built around least-privilege and a single gate:

- **Two database roles.**
  - `dbwatch` — a **read-only** role (granted `pg_monitor`). It powers every
    automatic/polling feature. The backend's monitoring connection pool also
    forces `default_transaction_read_only = on`, so even a mistaken write is
    rejected at the transaction level.
  - `postgres` (admin) — used **only** for the three deliberately-manual
    operations: running SQL in the editor, terminating a backend, and taking a
    backup. Never used for polling.
- **Single dashboard password.** The whole API sits behind one
  `DASHBOARD_PASSWORD`. The frontend stores it and sends it on every request as
  the `x-dashboard-password` header. `/api/health` and `/api/auth/login` are the
  only unauthenticated endpoints (so the login screen can show DB status).
- **5432 never exposed.** The database is reachable only from the host's Docker
  network. The AWS Security Group opens **only port 80**.
- **SQL Editor safety.** Every statement runs under a 15-second timeout; bare
  `SELECT`s get an automatic `LIMIT 500`; and `EXPLAIN ANALYZE` runs inside a
  transaction that is always **rolled back**, so analyzing an `UPDATE`/`DELETE`
  never mutates data.
- **Backup safety.** Filenames are validated against path traversal; only one
  `pg_dump` can run at a time (concurrency lock). No restore is exposed via the
  UI — that stays a manual admin operation.
- **No secrets in the repo.** Real credentials live only in `backend/.env`,
  which is gitignored. Only `.env.example` (placeholders) is committed.

---

## 5. The Nine Pages

Every data page auto-refreshes on a polling interval and shows loading
skeletons on first load, a lost-connection banner if the database becomes
unreachable, and inline error strips on failure.

### 5.1 Overview (`/`)
**Single-glance health dashboard.** Refreshes every 10s.

- **Health Score (0–100)** — a large colour-coded number (green ≥ 80, amber
  50–79, red < 50) computed from four 25-point checks, each shown with a ✓/✗:
  1. Cache hit ratio ≥ 95%
  2. No blocking sessions (via `pg_blocking_pids()`)
  3. No queries running longer than 60s
  4. Dead-tuple ratio < 5%
- **Metric cards:** active connections, cache hit ratio, database size, total
  commits, total rollbacks, longest running query. Cards turn amber/red when a
  value crosses a risk threshold.
- **Data source:** `pg_stat_database`, `pg_stat_activity`, `pg_stat_user_tables`.

### 5.2 Active Sessions (`/sessions`)
**Live view of every connection.** Refreshes every 10s.

- **Table:** PID, user, database, state, duration, wait event, query (truncated,
  full text on hover).
- **Filters:** state dropdown (active / idle / idle in transaction …) and a free
  text search across user, database, and query.
- **Highlight rules:** rows turn **red** for *idle in transaction > 30s* and
  **amber** for *active queries > 10s*.
- **Terminate:** the "Kill" button calls `pg_terminate_backend(pid)` behind a
  confirmation modal (uses the admin role; the tool never terminates its own
  connection).
- **Data source:** `pg_stat_activity`.

### 5.3 Database Statistics (`/database-stats`)
**Cumulative counters for the monitored database.** Refreshes every 10s.

- **Cards:** commits, rollbacks, blocks hit (cache), blocks read (disk), rows
  returned/fetched/inserted/updated/deleted, deadlocks, temp files, temp bytes.
- **Live cache-hit chart:** a Recharts line chart that accumulates cache-hit
  ratio samples over your session (kept in memory, last 30 points — no
  persistence needed).
- **Data source:** `pg_stat_database`.

### 5.4 Query Performance (`/query-performance`)
**The slow-query finder.** Refreshes every 15s.

- **Table:** normalized query text, calls, total time, mean time, rows, stddev.
- **Sort** by total time (default), mean time, or calls; **search** by query
  substring; queries with mean time > 1s get a red "slow" badge.
- **Reset stats:** calls `pg_stat_statements_reset()` behind a confirmation.
- **Graceful degradation:** if `pg_stat_statements` isn't installed, the page
  shows a friendly "not enabled" notice instead of erroring.
- **Data source:** `pg_stat_statements`.

### 5.5 SQL Editor (`/sql-editor`)
**A safe, manual query tool.**

- **Execute** — runs SQL and renders results in a table (with a sticky header,
  and `∅` for NULLs). Bare `SELECT`s are auto-limited to 500 rows.
- **EXPLAIN** — shows the query plan as formatted text.
- **EXPLAIN ANALYZE** — shows the plan *with real timings*; runs inside a
  rolled-back transaction so it's safe even on writes.
- **Query history:** your last 20 queries are saved in `localStorage`; click one
  to reload it.
- **Guards:** 15s statement timeout on every run; runs on the admin pool (this
  is the one place writes are allowed, by design).
- **Data source:** arbitrary SQL against the admin connection.

### 5.6 Backup Manager (`/backups`)
**Logical backups via `pg_dump`.** Refreshes every 10s.

- **Take Backup** — runs `pg_dump -Fc` (custom format) into the backups volume;
  disabled while a backup is in progress.
- **Table:** filename, creation time, size, with **Download** (streamed with
  auth) and **Delete** (confirmed) actions.
- **Retention policy:** after each backup, keeps the newest `BACKUP_KEEP_COUNT`
  (default 10) and prunes anything older than `BACKUP_KEEP_DAYS` (default 30).
- **Concurrency lock:** a second simultaneous backup request gets a `409`.
- **Restore** is intentionally *not* in the UI — download the `.dump` and run
  `pg_restore` manually (a deliberate safety decision).

### 5.7 Recent Activity (`/activity`)
**A live activity feed.** Refreshes every 5s.

- Shows the most recent session activity ordered by `state_change` — a practical
  alternative to live log-file tailing that needs zero extra infrastructure.
- **Table:** last change (relative "time ago"), PID, user, state, query.
- **Data source:** `pg_stat_activity`.

### 5.8 Cost & Performance Insights (`/insights`)
**Actionable tuning advice, computed entirely from PostgreSQL's own views.**
Refreshes every 30s.

Six analyses, each rendered as a card with a **severity badge** (High / Medium /
Low), the affected object, a detail line, and a one-line recommendation. A
summary bar counts findings by severity.

| Insight | Source | Recommendation |
|---|---|---|
| Missing index (seq scans, 0 index scans) | `pg_stat_user_tables` | Add an index on filtered columns |
| Unused index | `pg_stat_user_indexes` | Drop it — saves storage & write cost |
| Bloat / dead tuples > 5% | `pg_stat_user_tables` | Run `VACUUM` |
| Low cache hit ratio < 90% | `pg_stat_database` | Consider increasing `shared_buffers` |
| Slow queries (mean > 1s) | `pg_stat_statements` | Investigate with EXPLAIN ANALYZE |
| Large table (> 500 MB) with seq scans | `pg_stat_user_tables` | High I/O risk — index recommended |

### 5.9 Database Explorer (`/explorer`)
**Read-only object browser.** Refreshes every 30s.

- **Left tree:** collapsible sections for Tables (with size, row estimate, index
  count), Views, Indexes (with PK / unique badges), and Roles (with super/login
  badges).
- **Detail pane:** click a table to see its columns (name, type, nullable,
  default), total size, row estimate, and full index definitions.
- **Data source:** `pg_stat_user_tables`, `pg_views`, `pg_stat_user_indexes`,
  `pg_roles`, `information_schema.columns`, `pg_indexes`.

### Global UI
- **Login screen** — password gate; the connection banner works here too.
- **Theme toggle** — dark/light, persisted to `localStorage` (top-right).
- **Connection banner** — live DB status (version + database) in the header.
- **Lost-connection banner** — appears across all pages if the DB drops.

---

## 6. API Reference

All endpoints are under `/api` and (except health/login) require the
`x-dashboard-password` header.

| Method | Endpoint | Purpose | DB role |
|---|---|---|---|
| GET | `/api/health` | Connection status + server version | monitor |
| POST | `/api/auth/login` | Verify the dashboard password | — |
| GET | `/api/overview` | All Overview metrics + health score | monitor |
| GET | `/api/sessions` | `pg_stat_activity` snapshot | monitor |
| DELETE | `/api/sessions/:pid` | `pg_terminate_backend(pid)` | admin |
| GET | `/api/database-stats` | `pg_stat_database` counters | monitor |
| GET | `/api/query-performance` | `pg_stat_statements` top 50 | monitor |
| POST | `/api/query-performance/reset` | `pg_stat_statements_reset()` | admin |
| POST | `/api/sql/execute` | Run SQL, return rows | admin |
| POST | `/api/sql/explain` | `EXPLAIN` plan text | admin |
| POST | `/api/sql/explain-analyze` | `EXPLAIN ANALYZE` (rolled back) | admin |
| POST | `/api/backup/create` | Run `pg_dump -Fc` | admin |
| GET | `/api/backup/list` | List backups + retention info | — |
| GET | `/api/backup/download/:file` | Download a `.dump` | — |
| DELETE | `/api/backup/:file` | Delete a backup | — |
| GET | `/api/activity` | Recent activity by `state_change` | monitor |
| GET | `/api/insights` | All tuning insight cards | monitor |
| GET | `/api/explorer` | Tables/views/indexes/roles tree | monitor |
| GET | `/api/explorer/tables/:name` | Table detail (columns, indexes) | monitor |

---

## 7. Configuration (.env)

`backend/.env` (never committed — see `backend/.env.example` for the template):

```
DB_HOST=host.docker.internal   # how the container reaches host Postgres
DB_PORT=5432
DB_USER=dbwatch                # read-only monitoring role
DB_PASSWORD=...                # must match the dbwatch role's password
DB_NAME=internship_jusdb       # the monitored database
DB_ADMIN_USER=postgres         # admin role for SQL editor + backups
DB_ADMIN_PASSWORD=...          # must match the postgres role's password
DB_SSL=false                   # false over localhost/host network
BACKUP_DIR=./backups           # where dumps are written (Docker volume)
BACKUP_KEEP_COUNT=10           # retention: keep newest N (0 = unlimited)
BACKUP_KEEP_DAYS=30            # retention: drop older than D days (0 = off)
DASHBOARD_PASSWORD=...         # the single web-app login password
PORT=3001
CORS_ORIGIN=http://localhost   # relevant only for non-proxied dev
```

The frontend has one optional variable, `VITE_API_URL` (blank in the Docker
deployment because nginx serves it same-origin).

---

## 8. Deployment

DBWatch runs on the EC2 instance via Docker Compose. Full pre-build steps
(monitoring role, `pg_stat_statements`, `pg_hba.conf`, Docker install) are in
[`SETUP_EC2.md`](../SETUP_EC2.md). Summary once the box is prepared:

```bash
git clone https://github.com/SairajBhise2005/dbwatch.git
cd dbwatch
cp backend/.env.example backend/.env   # fill in real values
sudo docker compose up -d --build
```

- **Ports:** only 80 is published (the frontend). The backend is internal
  (`expose: 3001`); Postgres stays on the host.
- **Auto-restart:** both containers use `restart: unless-stopped`, so the app
  comes back automatically after a reboot.
- **Redeploy after changes:** `git pull && sudo docker compose up -d --build`.
- **Backups persistence:** the `./backups` directory is bind-mounted so dumps
  survive container restarts.
- **Small instances:** a 2 GB swap file is recommended so the frontend image
  build (Vite) doesn't run out of memory on free-tier RAM.

Open `http://<EC2-public-IP>/` and log in with `DASHBOARD_PASSWORD`.

---

## 9. Local Development

Run the two apps directly against any PostgreSQL (e.g. a local Docker Postgres):

```bash
# Terminal 1 — backend
cd backend
cp .env.example .env      # point at your local/test DB
npm install
npm run dev               # http://localhost:3001

# Terminal 2 — frontend
cd frontend
npm install
npm run dev               # http://localhost:5173  (proxies /api → :3001)
```

The Vite dev server proxies `/api` to `localhost:3001`, mirroring the production
nginx setup, so behaviour is identical to the deployed app.

---

## 10. Project Structure

```
.
├── backend/                   Express API
│   ├── routes/
│   │   ├── health.js          GET /api/health
│   │   ├── overview.js        GET /api/overview (+ health score)
│   │   ├── sessions.js        pg_stat_activity + terminate
│   │   ├── database.js        pg_stat_database
│   │   ├── queries.js         pg_stat_statements + reset
│   │   ├── sql.js             execute / explain / explain-analyze
│   │   ├── backup.js          create / list / download / delete + retention
│   │   ├── insights.js        6 tuning analyses
│   │   ├── explorer.js        object browser
│   │   └── activity.js        recent activity feed
│   ├── middleware/auth.js     single-password gate
│   ├── db.js                  monitor + admin connection pools
│   ├── server.js              Express entry point
│   ├── Dockerfile             node + postgresql-client
│   └── .env.example
│
├── frontend/                  React + Vite app
│   ├── src/
│   │   ├── pages/             one component per page
│   │   ├── components/        Layout, ui, ConfirmModal, ConnectionBanner
│   │   ├── hooks/             usePolling, useHealth, useTheme
│   │   ├── lib/               api client, formatters
│   │   └── types/             shared TypeScript interfaces
│   ├── nginx.conf             serves SPA + proxies /api
│   └── Dockerfile             multi-stage: vite build → nginx
│
├── docker-compose.yml         runs both containers on EC2
├── SETUP_EC2.md               EC2 pre-build checklist
├── README.md                  quick start + overview
└── docs/DOCUMENTATION.md      this file
```

---

## 11. Internship Concept Mapping

Every feature maps back to a phase of the internship:

| Feature | Concept / Phase |
|---|---|
| Active Sessions monitor | `pg_stat_activity` — Phase 9 |
| Cache hit ratio, DB statistics | `pg_stat_database` — Phase 9 |
| Slow query finder | `pg_stat_statements` — Phase 9 |
| EXPLAIN / EXPLAIN ANALYZE | Query optimization — Phase 6 |
| Backup Manager | `pg_dump` / backup formats — Phase 7 |
| Cost & Performance Insights | Cloud cost optimization — Phase 12 |
| Health Score | PostgreSQL monitoring — Phase 11 |
| Database Explorer | PostgreSQL components — Phase 2 |
| Recent Activity | Logging alternative, `state_change` — Phase 5, 9 |
| Blocking / dead-tuple detection | MVCC, VACUUM, `pg_blocking_pids()` — Phase 8, 9 |
| Read-only role, single-password auth | Security, roles, `pg_hba.conf` — Phase 10 |
| Docker on EC2, internal networking | AWS EC2 hosting — Phase 1, 12 |
| This document + README + SETUP_EC2 | Documentation — Phase 13 |

---

*DBWatch — built as a final internship project, deployed on AWS EC2, connecting
live to PostgreSQL 18.*
