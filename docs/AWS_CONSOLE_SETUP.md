# AWS Console Setup Guide

A click-by-click walkthrough for provisioning everything DBWatch needs in the
**AWS Management Console**: the EC2 host, the RDS PostgreSQL database, the
security groups, the parameter group, and the IAM role for CloudWatch.

> This is the **console** companion to the command-line docs:
> - On-box commands → [`SETUP_EC2.md`](../SETUP_EC2.md)
> - Integration overview → [`AWS_RDS_INTEGRATION.md`](AWS_RDS_INTEGRATION.md)
> - Private networking → [`PRIVATE_RDS_ARCHITECTURE.md`](PRIVATE_RDS_ARCHITECTURE.md)

Do the steps in order. Keep everything in **one region** (top-right of the
console) — mixing regions is the #1 cause of "can't connect" issues.

---

## 0. Before you start

- An AWS account with console access.
- Pick and **stay in one region** (e.g. `us-east-1`). Note it — it becomes
  `AWS_REGION` in `backend/.env`.
- Decide two passwords you'll reuse later: the **RDS master password** and the
  **dbwatch role password**.

---

## 1. EC2 instance (the app host)

*If you already have the EC2 box running DBWatch, skip to §2.*

1. **Console → EC2 → Instances → Launch instances.**
2. **Name:** `dbwatch-host`.
3. **AMI:** Ubuntu Server (LTS).
4. **Instance type:** `t3.micro` (free tier).
5. **Key pair:** create/download one (`.pem`) — you'll SSH with it.
6. **Network settings → Create security group** named `dbwatch-app-sg` with:
   - **SSH (22)** — Source: *My IP*
   - **HTTP (80)** — Source: *Anywhere* (public demo) or *My IP*
7. **Launch instance.**
8. (Recommended) **EC2 → Elastic IPs → Allocate → Associate** with this instance
   so the URL survives reboots.

---

## 2. Provision the RDS PostgreSQL database

1. **Console → RDS → Databases → Create database.**
2. **Creation method:** Standard create.
3. **Engine:** PostgreSQL. **Version:** the latest available (ideally match your
   source, PostgreSQL 18 — see the version note in `AWS_RDS_INTEGRATION.md`).
4. **Templates:** **Free tier**.
5. **Settings:**
   - **DB instance identifier:** `dbwatch-rds`  ← this becomes `RDS_INSTANCE_ID`.
   - **Master username:** `postgres`.
   - **Master password:** set + confirm (save it).
6. **Instance configuration:** `db.t3.micro` (or `db.t4g.micro`).
7. **Storage:** 20 GB, gp3. (Optionally enable storage autoscaling.)
8. **Connectivity:**
   - **Compute resource:** *Don't connect to an EC2 compute resource* (we set SGs
     manually).
   - **VPC:** the **same VPC as your EC2 instance**.
   - **Public access:** **No**.
   - **VPC security group:** *Create new* → name it `dbwatch-rds-sg`.
9. **Additional configuration (expand):**
   - **Initial database name:** `internship_jusdb`.
   - **Backup:** keep automated backups on (7 days).
   - **Performance Insights:** **Enable** (free, 7-day retention).
10. **Create database.** Provisioning takes ~10–15 minutes.
11. When status is **Available**, open the instance and copy the
    **Endpoint** (e.g. `dbwatch-rds.abc123.us-east-1.rds.amazonaws.com`) —
    it becomes `DB_HOST`.

---

## 3. Security group — let the EC2 app reach RDS (privately)

Goal: RDS accepts 5432 **only** from the EC2 app's security group — never the
public internet.

1. **Console → EC2 → Security Groups → `dbwatch-rds-sg` → Inbound rules → Edit.**
2. **Add rule:**
   - **Type:** PostgreSQL (port 5432).
   - **Source:** start typing and select **`dbwatch-app-sg`** (the EC2 instance's
     security group) — *not* an IP, and *not* `0.0.0.0/0`.
3. **Save rules.**

> Referencing the app's security group (instead of an IP) keeps RDS private and
> survives IP changes. Port 5432 is never exposed publicly.

---

## 4. Parameter group — enable `pg_stat_statements`

RDS has no `postgresql.conf` to edit; you use a parameter group instead.

1. **Console → RDS → Parameter groups → Create parameter group.**
   - **Type:** DB parameter group.
   - **Parameter group family:** match your engine (e.g. `postgres18`).
   - **Name:** `dbwatch-pg`.
2. Open `dbwatch-pg` → **Edit parameters** → search
   **`shared_preload_libraries`** → set value to **`pg_stat_statements`** → Save.
3. **RDS → Databases → `dbwatch-rds` → Modify → Additional configuration → DB
   parameter group →** select **`dbwatch-pg`** → **Continue → Apply immediately**.
4. **Reboot** the instance (Actions → Reboot) so the static parameter takes
   effect.

*(You'll run `CREATE EXTENSION pg_stat_statements;` later — see `AWS_RDS_INTEGRATION.md` §4.6.)*

---

## 5. IAM role — CloudWatch metrics for the app

The backend reads CloudWatch/RDS via the EC2 instance's IAM role (no keys).

1. **Console → IAM → Roles → Create role.**
2. **Trusted entity type:** AWS service → **Use case: EC2** → Next.
3. **Add permissions** — attach these AWS-managed policies:
   - **`CloudWatchReadOnlyAccess`**
   - **`AmazonRDSReadOnlyAccess`**
4. **Role name:** `dbwatch-monitoring` → **Create role.**
5. Attach it to the instance: **EC2 → Instances → `dbwatch-host` → Actions →
   Security → Modify IAM role →** select **`dbwatch-monitoring`** → **Update IAM
   role.**

> No access keys are stored anywhere — the AWS SDK on the instance picks up the
> role automatically.

---

## 6. What maps to `backend/.env`

After the console work, these are the values you'll set on the EC2 box:

| Console item | `.env` key |
|---|---|
| RDS endpoint (§2.11) | `DB_HOST` |
| `internship_jusdb` | `DB_NAME` |
| dbwatch role password (created in Stage B) | `DB_PASSWORD` |
| RDS master password (§2.5) | `DB_ADMIN_PASSWORD` |
| — (RDS requires TLS) | `DB_SSL=true` |
| Region (top-right of console) | `AWS_REGION` |
| DB instance identifier `dbwatch-rds` (§2.5) | `RDS_INSTANCE_ID` |

Then finish with the database migration + role creation and redeploy — see
[`AWS_RDS_INTEGRATION.md`](AWS_RDS_INTEGRATION.md) §4.5–4.7.

---

## 7. Quick verification

- **RDS Available?** RDS → Databases → status = *Available*.
- **App reaches DB?** on EC2: `curl -s http://localhost/api/health` → `"connected":true`.
- **CloudWatch working?** `curl -s -H "x-dashboard-password: <pw>" http://localhost/api/cloud/overview`
  → `"available":true` with your instance class + metrics (needs the IAM role
  from §5 attached).
- **Metrics in the UI?** open the **Infra Vitals** and **Cost Realization** tabs.

---

## 8. Common pitfalls

| Symptom | Likely cause |
|---|---|
| App can't connect to RDS | RDS SG not allowing `dbwatch-app-sg`; or wrong VPC |
| `connected:false`, SSL error | `DB_SSL` not `true` |
| Query Performance page empty | parameter group not applied / not rebooted, or `CREATE EXTENSION` not run |
| Infra Vitals "not available" | IAM role not attached, or wrong `AWS_REGION`/`RDS_INSTANCE_ID` |
| Metrics blank but instance shows | CloudWatch lag (~1–2 min) or instance just booted |
