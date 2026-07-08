# EC2 Pre-Build Checklist (Stage 1)

Your EC2 instance is running but not yet configured for DBWatch. Do these
steps **on the EC2 box** before deploying. They set up a safe read-only
monitoring role, enable the stats extension, and let the Docker containers
reach PostgreSQL over the host's internal network — **without exposing
port 5432 to the internet**.
****
> Architecture reminder: the backend runs in Docker *on this same EC2
> instance* and connects to PostgreSQL over the local Docker bridge, so
> the only port you open to the world is **80** (the web app).

---

## 1. Security Group (AWS Console → EC2 → Security Groups)

| Rule | Port | Source | Purpose |
|---|---|---|---|
| HTTP | 80 | Your IP (or 0.0.0.0/0 for a public demo) | The DBWatch web app |
| SSH | 22 | Your IP | Admin access |
| PostgreSQL | 5432 | **Do NOT open** | Stays internal to the host |

An Elastic IP is recommended so the URL doesn't change on reboot
(EC2 → Elastic IPs → Allocate → Associate with your instance).

---

## 2. Create the read-only monitoring role

Connect as the postgres superuser and run:

```sql
-- Read-only role the dashboard uses for ALL monitoring.
CREATE ROLE dbwatch WITH LOGIN PASSWORD 'pick-a-strong-password';

-- pg_monitor grants read access to all the pg_stat_* views.
GRANT pg_monitor TO dbwatch;

-- Let it connect to and read your target database.
GRANT CONNECT ON DATABASE internship_jusdb TO dbwatch;
\c internship_jusdb
GRANT USAGE ON SCHEMA public TO dbwatch;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dbwatch;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dbwatch;
```

> If your database isn't named `internship_jusdb`, substitute your real
> database name here and in `backend/.env`.

---

## 3. Enable pg_stat_statements (needed for Query Performance, Stage 3)

Edit `postgresql.conf` (find it with `SHOW config_file;`):

```conf
shared_preload_libraries = 'pg_stat_statements'
```

Then restart PostgreSQL and create the extension:

```bash
sudo systemctl restart postgresql
```
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

---

## 4. Let the Docker containers reach PostgreSQL

The backend container connects via `host.docker.internal`, which resolves
to the Docker bridge gateway on the host. PostgreSQL must listen on that
interface and allow the Docker subnet.

**`postgresql.conf`:**
```conf
listen_addresses = '*'      # safe: port 5432 is NOT open in the Security Group
```

**`pg_hba.conf`** — add this line (covers Docker's private subnets):
```conf
# Allow the DBWatch containers (Docker bridge) to connect
host    all    dbwatch    172.16.0.0/12    scram-sha-256
```

Reload:
```bash
sudo systemctl reload postgresql
```

---

## 5. Install Docker + Compose on EC2 (if not already)

```bash
# Amazon Linux 2023
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out/in after this

# Docker Compose plugin
sudo dnf install -y docker-compose-plugin
```
(For Ubuntu, use `apt-get install -y docker.io docker-compose-plugin`.)

---

## 6. Deploy

```bash
git clone <your-repo> dbwatch && cd dbwatch

# Create the backend env file from the template and fill it in
cp backend/.env.example backend/.env
nano backend/.env      # set DB_PASSWORD, DB_ADMIN_PASSWORD,
                       # DB_NAME, DASHBOARD_PASSWORD

docker compose up -d --build
```

Open `http://<your-elastic-ip>/` — you should see the DBWatch login,
and after entering the dashboard password, the header banner should turn
green with your PostgreSQL version.

---

## Quick local test (optional, before deploying)

From the EC2 box, confirm the monitoring role works:

```bash
psql -h 127.0.0.1 -U dbwatch -d internship_jusdb -c "SELECT version();"
```

If that returns a version string, Stage 1 is good to go.
