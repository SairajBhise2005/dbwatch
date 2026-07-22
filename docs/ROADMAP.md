# DBWatch — Feedback Response & Roadmap

Plan for the review feedback. **A large share is already shipped** — this maps
every item to its status so we build only what's new, then phases the rest.

LLM provider for all AI features: **Google Gemini API** (backend-proxied).

---

## 1. Status of every feedback item

Legend: ✅ done · 🟡 partial · 🔴 new

| Feedback item | Status | Where / note |
|---|---|---|
| **CloudWatch metrics** (CPU, mem, storage, disk I/O, network I/O, R/W latency, IOPS, free storage, connections) | ✅ | Infra Vitals (`Cloud.tsx`, `aws.js` METRICS) — all present |
| Health diagnostics (bottlenecks, saturation, unhealthy) | ✅ | Live Telemetry (`routes/diagnostics.js`, 9 checks) |
| Distinct connected users + total connections/threads | ✅ | `routes/sessions.js` summary |
| Real AWS billing + estimated monthly + up/down-scale + $ impact | ✅ | Cost Realization (`routes/cost.js`, Cost Explorer) |
| Slow-query analysis | ✅ | Query Performance (`pg_stat_statements`) |
| Create database / create table | ✅ | Database Viewer (`routes/explorer.js`) |
| Private RDS + Bastion + SSH tunneling **research** | ✅ | `docs/PRIVATE_RDS_ARCHITECTURE.md` |
| Error handling / graceful degradation | 🟡 | Present throughout; needs a hardening pass |
| Cost: idle / underutilized / storage / Reserved Instance recs | 🟡 | Have CPU-based up/down-scale; extend the rest |
| **Active database locks** view | 🔴 | New — `pg_locks` + `pg_blocking_pids` |
| DB Viewer: **edit schema, drop (confirm), `.sql` import** | 🔴 | New — extends existing create flow |
| **Private RDS connectivity in the app** (bastion / SSH tunnel, public+private) | 🔴 | New — research done, code not |
| **AI query optimization** (detect, rewrite, index/plan advice) | 🔴 | New — Gemini |
| **AI-based diagnostic recommendations** in Live Telemetry | 🔴 | New — Gemini |
| **AI/ML anomaly detection** (research top 3, implement, compare) | 🔴 | New — research + build |
| Bug fixes / stability | 🟡 | Ongoing |

**Takeaway:** infra monitoring, telemetry metrics, cost billing, and slow-query
tooling are done. New work clusters into: locks + schema management, private-RDS
connectivity, three AI features, and cost-rec extensions.

---

## 2. Phased plan

### Phase 1 — Quick wins, no AI (rounds out the dashboard)
- **Active locks view** — new `GET /api/locks` from `pg_locks` joined to
  `pg_stat_activity` + `pg_blocking_pids()` (blocker → blocked, relation, mode,
  granted). Surface on Live Telemetry.
- **Drop database / drop table** — `DELETE` endpoints in `routes/explorer.js`,
  reuse the `IDENT` guard + `ConfirmModal`; type-to-confirm for drops.
- **Edit schema** — add/drop column, rename (`ALTER TABLE`); extend the existing
  create-table modal into an editor.
- Effort: ~2 days. Highest value-per-effort; no new deps.

### Phase 2 — Private RDS connectivity in the app
- Add optional **SSH-tunnel** support to `db.js`: when `SSH_*` env is set, open a
  tunnel through the bastion (dep: `tunnel-ssh`) and point the pools at the local
  end. When unset, connect directly (today's behavior) — so **public and private
  RDS both work**.
- Env: `SSH_HOST`, `SSH_USER`, `SSH_KEY`, `SSH_TARGET_HOST/PORT`.
- Doc already exists (`PRIVATE_RDS_ARCHITECTURE.md`); add the "app-tunnel" mode.
- Effort: ~2 days. `ponytail:` prefer AWS SSM port-forward in docs as the
  keyless alternative.

### Phase 3 — `.sql` import + cost-rec extensions
- **`.sql` import** — upload a `.sql` file → run through the admin pool inside a
  transaction (rollback on error) → refresh the tree. Reuse `withDb()`.
- **Cost extensions** in `routes/cost.js`: idle detection (avg connections ≈ 0 +
  low CPU), storage over-provisioning (large free-storage %), Reserved Instance
  hint (steady 24×7 usage → RI savings estimate from the price table), each with
  a $ impact line.
- Effort: ~2–3 days.

### Phase 4 — AI features (Gemini) ⭐ the headline items
Shared foundation (build once):
- **Backend AI proxy** — `routes/ai.js` calling the Gemini API via the
  `@google/genai` SDK. `GEMINI_API_KEY` lives in `backend/.env` only (never the
  frontend). Graceful `{available:false}` when the key is unset, matching the
  `aws.js` pattern.
- Model tiers: a **Flash**-class model for fast/cheap inline calls (query
  suggestions, diagnostic advice); a **Pro**-class model for deeper analysis.
  Cache/rate-limit responses; cap prompt size.

Then:
- **4a. AI query optimization** — on Query Performance / SQL Editor, an "Optimize
  with AI" action sends the query text + its `EXPLAIN` plan + table/index metadata
  to Gemini → returns a rewritten query, suggested indexes, and plan-improvement
  notes. Read-only advice; user applies manually.
- **4b. AI diagnostic recommendations** — feed the Phase-1 diagnostics + current
  metrics to Gemini → plain-language remediation steps on Live Telemetry
  (augments, doesn't replace, the rule-based checks).
- Effort: ~3–4 days (4a + 4b share the proxy).

### Phase 5 — AI/ML anomaly detection (research + build)
- **Research deliverable** comparing 3 approaches on accuracy / performance /
  resource use / ease (candidates: (1) statistical — rolling z-score / EWMA,
  (2) Isolation Forest, (3) time-series residual — Prophet or LSTM-autoencoder).
- **Build lazily**: ship the **statistical baseline in Node** first (no new
  service) over CloudWatch + `pg_stat` time-series; add **Isolation Forest**
  (small Python sidecar, scikit-learn) only if the baseline misses real
  anomalies. Optionally use Gemini to *explain* flagged anomalies in words.
- Test against real RDS logs/metrics; document the comparison.
- Effort: ~4–5 days incl. research. Largest, most uncertain — schedule last.

---

## 3. Research deliverables (write-ups)
1. AI models for SQL query optimization (approach + prompt design + limits).
2. Anomaly-detection algorithms — top 3, comparison, chosen approach + results.
3. Private RDS via Bastion + SSH tunnel — ✅ exists (`PRIVATE_RDS_ARCHITECTURE.md`); extend with the app-tunnel mode.
4. CloudWatch metric integration — ✅ covered in `AWS_RDS_INTEGRATION.md`.
5. Cost Explorer integration — ✅ covered in `AWS_RDS_INTEGRATION.md`.

---

## 4. Constraints & risks
- **AI cost/latency** — Gemini calls cost money and add latency; cache results,
  gate behind explicit user actions (not polling), cap tokens.
- **Anomaly detection needs history** — CloudWatch is ~daily-lagged and RDS is
  low-traffic; models may have thin signal. Start statistical.
- **Drops/edits are destructive** — behind the admin pool + type-to-confirm only.
- **SSH tunneling** adds a bastion to run/secure; SSM port-forward is the
  lower-maintenance alternative for admin access.
- Scope is large (~2–3 weeks). Recommend building **Phase 1 → 4 → 5** by value;
  2 and 3 slot in as needed.

---

## 5. Suggested build order
1. **Phase 1** (locks, drop, edit) — fast, visible, no deps.
2. **Phase 4a** (AI query optimization) — the marquee feature; needs `GEMINI_API_KEY`.
3. **Phase 4b** (AI recommendations) — reuses the proxy.
4. **Phase 5** (anomaly detection) — research first, then statistical baseline.
5. **Phases 2 & 3** (private-RDS tunnel, `.sql` import, cost recs) — as prioritized.
