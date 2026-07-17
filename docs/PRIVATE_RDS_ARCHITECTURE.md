# Private RDS Architecture — Feasibility & Implementation

**Task:** investigate transitioning the RDS instance to a **private subnet**,
using a **bastion / jumpbox** and **SSH tunneling** for secure connectivity.

This document covers the target architecture, how DBWatch connects, how a human
admin connects, the trade-offs, and step-by-step implementation.

---

## 1. Goal & Key Insight

The goal is that RDS is **never reachable from the public internet** — no public
IP, no `0.0.0.0/0` on 5432 — while both the application and administrators can
still reach it securely.

**Key insight for this project:** DBWatch's backend runs in Docker **on an EC2
instance inside the same VPC** as RDS. A private RDS is therefore **directly
reachable by the backend over the VPC's private network** — no tunnel, no
bastion needed *for the app*. The bastion + SSH tunnel is needed only for
**human/tool access** (psql, pgAdmin, DBeaver) from outside the VPC.

So there are two connectivity paths, and they're solved differently:

| Who connects | Path | Mechanism |
|---|---|---|
| DBWatch backend (in-VPC) | Direct | RDS private endpoint + security group |
| A developer's laptop (outside VPC) | Indirect | Bastion/jumpbox + SSH tunnel, or SSM |

---

## 2. Target Network Architecture

```
                         VPC (10.0.0.0/16)
   ┌───────────────────────────────────────────────────────────────┐
   │  Public subnet (10.0.1.0/24)          Private subnets           │
   │  ┌──────────────┐                     (10.0.11.0/24, .12.0/24)  │
   │  │  Bastion /   │  SSH (22) from        ┌───────────────────┐   │
   │  │  Jumpbox     │◀── your IP only       │  RDS PostgreSQL    │   │
   │  └──────┬───────┘                       │  (no public IP)    │   │
   │         │ tunnel :5432 ────────────────▶│  SG: allow 5432    │   │
   │  ┌──────┴───────┐                       │  from app+bastion  │   │
   │  │  EC2 (app)   │── 5432 (private) ─────▶│  SG only           │   │
   │  │  DBWatch     │                        └───────────────────┘   │
   │  └──────────────┘                                                │
   │   Internet Gateway (public subnet only)                          │
   └───────────────────────────────────────────────────────────────┘
```

- **RDS** lives in **private subnets** across ≥2 AZs (a *DB subnet group*),
  `Publicly Accessible = No`.
- **Security groups** (identity-based, not IPs):
  - `rds-sg` inbound 5432 ← **`app-sg`** (the EC2 app) and **`bastion-sg`**.
  - `bastion-sg` inbound 22 ← **your office/home IP** only.
  - `app-sg` needs no inbound for the DB (it's the *source*).
- The private subnets have **no route to an Internet Gateway** (optionally a NAT
  gateway for outbound patching if self-managed — not needed for RDS, which AWS
  patches).

---

## 3. How DBWatch Connects (no change needed)

Because the backend EC2 is in the same VPC, `backend/.env` simply points
`DB_HOST` at the **RDS private endpoint** (the same `*.rds.amazonaws.com` DNS —
it resolves to a private IP when the instance isn't public):

```
DB_HOST=dbwatch-rds.xxxx.us-east-1.rds.amazonaws.com
DB_SSL=true
```

The connection stays entirely inside the VPC. This is already how DBWatch is
deployed — making RDS private requires **zero application changes**, only the
networking (private subnets + `Publicly Accessible = No` + SG referencing
`app-sg`).

---

## 4. Human Access via Bastion + SSH Tunnel

For running `psql`/pgAdmin against the private RDS from a laptop:

### Option A — Bastion host + SSH local port-forward
1. Launch a tiny EC2 (`t3.micro`) in the **public subnet** = the bastion; SG
   allows SSH (22) from your IP only.
2. Allow `rds-sg` inbound 5432 from `bastion-sg`.
3. From your laptop, open a tunnel:
   ```bash
   ssh -i key.pem -N -L 5432:dbwatch-rds.xxxx.rds.amazonaws.com:5432 ec2-user@<bastion-public-ip>
   ```
4. Connect as if RDS were local:
   ```bash
   psql "host=127.0.0.1 port=5432 user=postgres dbname=internship_jusdb sslmode=require"
   ```
   Traffic flows laptop → (SSH, encrypted) → bastion → (private VPC) → RDS.

### Option B — AWS SSM Session Manager port forwarding (recommended)
No bastion SSH port open at all, no SSH keys to manage:
1. Give the jumpbox instance the `AmazonSSMManagedInstanceCore` role.
2. Port-forward through SSM:
   ```bash
   aws ssm start-session --target <instance-id> \
     --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters host=<rds-endpoint>,portNumber=5432,localPortNumber=5432
   ```
3. Connect to `localhost:5432` as above.

SSM is more secure (no inbound 22, IAM-audited, no key sprawl) and is the
modern best practice.

---

## 5. Feasibility & Trade-offs

| Aspect | Assessment |
|---|---|
| **Feasibility** | High. RDS supports private subnets natively; this is the recommended production pattern. |
| **App impact** | None — the in-VPC backend already connects privately. |
| **Security gain** | Large — DB removed from the public attack surface; access is SG- + identity-scoped. |
| **Admin friction** | Slightly higher — humans need the tunnel/SSM to connect. |
| **Cost** | Bastion ≈ a `t3.micro` (or $0 with SSM to an existing instance). NAT gateway only if private subnets need outbound (not for RDS). |
| **Availability** | DB subnet group across ≥2 AZs; pair with Multi-AZ for failover. |

---

## 6. Implementation Checklist

1. Create/confirm **private subnets** in ≥2 AZs; create a **DB subnet group**.
2. Set RDS **`Publicly Accessible = No`** and place it in the private subnet group.
3. Create SGs: `app-sg`, `bastion-sg`, `rds-sg`; set `rds-sg` 5432 ← `app-sg` + `bastion-sg`.
4. Keep the DBWatch EC2 in the VPC; point `DB_HOST` at the RDS endpoint (already done).
5. For human access, stand up a bastion **or** enable SSM on an instance; use §4.
6. (Optional, future) If the backend ever runs **outside** the VPC, add SSH-tunnel
   support to `db.js` using a Node SSH tunneling library (e.g. `tunnel-ssh`) so the
   `pg` pool dials through the bastion. Not required for the current in-VPC design.

---

## 7. Conclusion

Transitioning to a private RDS is **fully feasible and low-risk** for DBWatch:
the application already connects from inside the VPC, so making the database
private is purely a networking change. The bastion/SSH-tunnel (or, preferably,
SSM port forwarding) cleanly covers ad-hoc human/tool access without ever
exposing the database publicly.
