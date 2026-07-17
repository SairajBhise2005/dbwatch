# DBWatch — PostgreSQL Monitoring Dashboard

A lightweight, self-hosted database administration dashboard for PostgreSQL —
inspired by pgAdmin and Grafana, built to monitor a PostgreSQL instance running
on AWS EC2. Final internship project tying together Linux, AWS, PostgreSQL
architecture, performance monitoring, query optimization, backups, and security.

> **Status:** Complete and deployed. Now integrated with **Amazon RDS** +
> **CloudWatch** — see [AWS RDS Integration](docs/AWS_RDS_INTEGRATION.md) for the
> managed-database migration, the new **Cloud (RDS)** page, and a comparison
> with the self-managed setup.

**Docs:** [Full documentation](docs/DOCUMENTATION.md) ·
[AWS Console setup](docs/AWS_CONSOLE_SETUP.md) ·
[AWS RDS + CloudWatch integration](docs/AWS_RDS_INTEGRATION.md) ·
[Private RDS architecture](docs/PRIVATE_RDS_ARCHITECTURE.md)

### v2 highlights (AWS upgrade)

- **New palette** — One-Dark theme (mint accent), more **graphs/gauges** over raw numbers.
- **Live Telemetry** — distinct-user + connection-state metrics and an **automated health-diagnostics** panel.
- **Infra Vitals** — expanded CloudWatch coverage (CPU, memory, storage, IOPS, latency, throughput, network, disk queue, CPU credits).
- **Cost Realization** — pricing-based monthly bill estimate + concrete up/down-scale recommendations with $ impact.
- **Database Viewer** — interactive **create database / create table** (injection-safe DDL).
- **Private RDS** — research + same-VPC-direct architecture (bastion / SSH tunnel / SSM for admin access).

---

## Architecture

Unlike a split Vercel/Render deployment, DBWatch runs **entirely on the EC2
instance** alongside PostgreSQL. This means the backend connects over the
host's internal network (port 5432 never faces the internet) and can read
logs and run `pg_dump` locally.

```
                 Browser
                    │  HTTP (port 80)
                    ▼
        ┌──────────────────────┐   AWS EC2 (Ubuntu / Amazon Linux)
        │  nginx  (frontend)   │
        │  React + TS + Vite   │
        └──────────┬───────────┘
                   │  /api  (reverse proxy, same-origin)
                   ▼
        ┌──────────────────────┐
        │  Node.js + Express   │
        │  (backend)           │
        └──────────┬───────────┘
                   │  node-postgres (localhost, read-only role)
                   ▼
        ┌──────────────────────┐
        │  PostgreSQL 18       │
        └──────────────────────┘
```

Both the frontend and backend run as Docker containers via `docker-compose`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Routing | React Router v7 |
| Backend | Node.js + Express |
| DB driver | node-postgres (`pg`) |
| Deploy | Docker Compose on AWS EC2 (nginx + node) |

---

## Security model

- **Two DB roles.** A read-only `dbwatch` role (`pg_monitor`) powers all
  automatic monitoring — it physically cannot write. A separate admin role
  is used only for the manual SQL editor and backups (later stages).
- The monitoring pool also forces `default_transaction_read_only=on`.
- **Single dashboard password** (`DASHBOARD_PASSWORD`) gates the whole API —
  no secrets in the frontend.
- **5432 is never exposed** — the backend reaches PostgreSQL over the Docker
  bridge on the host. Only port 80 is public.
- No credentials are committed — see `.gitignore` and the `.env.example` files.

---

## Local development

```bash
# Terminal 1 — backend
cd backend
cp .env.example .env        # fill in DB creds + DASHBOARD_PASSWORD
npm install
npm run dev                 # http://localhost:3001/api/health

# Terminal 2 — frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api → backend)
```

The frontend dev server proxies `/api` to `localhost:3001`, so it behaves the
same as the production nginx setup.

---

## Deployment (EC2)

See **[SETUP_EC2.md](./SETUP_EC2.md)** for the full pre-build checklist
(monitoring role, `pg_stat_statements`, security group, Docker install), then:

```bash
cp backend/.env.example backend/.env   # fill in
docker compose up -d --build
```

Open `http://<elastic-ip>/`.

---

## Build Progress

Built in strict stages, each a working, demonstrable product. Every stage
was verified against a real PostgreSQL (throwaway Docker container) before
moving on. **All stages complete.**

- [x] **Stage 1 — Foundation:** Express server + pg pools, `/api/health`,
      React shell with sidebar nav for all 9 pages, live connection banner,
      password auth gate, Docker + compose, EC2 setup guide.
- [x] **Stage 2 — Core Monitoring:** Overview (health score + metric cards),
      Active Sessions (filters, highlight rules, terminate), Database
      Statistics with a live cache-hit chart.
- [x] **Stage 3 — Query Tools:** Query Performance (`pg_stat_statements`,
      sort/search/reset), SQL Editor with Execute / EXPLAIN / EXPLAIN ANALYZE,
      query history, auto-`LIMIT 500`, and rollback-safe analyze.
- [x] **Stage 4 — Backups:** Backup Manager (`pg_dump -Fc`, list, download,
      **delete**, **retention policy**, **concurrency lock**).
- [x] **Stage 5 — Insights & Explorer:** Cost/Performance Insights (6 analyses
      from PG views), read-only Database Explorer (tables/views/indexes/roles).
- [x] **Stage 6 — Polish:** dark/light theme toggle, loading skeletons,
      lost-connection banner + error states, Recent Activity page, README,
      chunk-split production build.

### Nine pages

Overview · Active Sessions · Database Statistics · Query Performance ·
SQL Editor · Backup Manager · Recent Activity · Cost & Insights · DB Explorer

---

## Screenshots

> **To add (final manual step):** run the app against your EC2 database and
> capture each page into `docs/screenshots/`, then link them here. Suggested:

| Page | File |
|---|---|
| Overview (health score) | `docs/screenshots/overview.png` |
| Active Sessions | `docs/screenshots/sessions.png` |
| Query Performance | `docs/screenshots/query-performance.png` |
| SQL Editor + EXPLAIN | `docs/screenshots/sql-editor.png` |
| Backup Manager | `docs/screenshots/backups.png` |
| Cost & Insights | `docs/screenshots/insights.png` |
| Database Explorer | `docs/screenshots/explorer.png` |

---

## Internship concepts demonstrated

| Dashboard feature | Concept / phase |
|---|---|
| Active Sessions monitor | `pg_stat_activity` (Phase 9) |
| Cache hit ratio, DB stats | `pg_stat_database` (Phase 9) |
| Slow query finder | `pg_stat_statements` (Phase 9) |
| EXPLAIN / EXPLAIN ANALYZE | Query optimization (Phase 6) |
| Backup Manager | `pg_dump` (Phase 7) |
| Cost & Performance Insights | Cloud cost optimization (Phase 12) |
| Health Score | PostgreSQL monitoring (Phase 11) |
| Database Explorer | PostgreSQL components (Phase 2) |
| Recent Activity | `pg_stat_activity`, `state_change` (Phase 5, 9) |
| Blocking / dead-tuple detection | MVCC, `VACUUM`, `pg_blocking_pids()` (Phase 8, 9) |
| Backup retention & pg_dump formats | Backups (Phase 7) |
| Read-only role, auth | Security, roles, `pg_hba.conf` (Phase 10) |
| Docker on EC2 | AWS EC2 hosting (Phase 1, 12) |

---

## Repository layout

```
.
├── backend/            Express API (pg pools, routes, auth, Dockerfile)
├── frontend/           React + Vite app (pages, components, nginx Dockerfile)
├── docker-compose.yml  Runs both on EC2
├── SETUP_EC2.md        Pre-build checklist for the EC2 instance
└── README.md
```
