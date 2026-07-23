# Anomaly Detection — Research & Implementation

Deliverable for the feedback item *"Research the top 3 AI/ML models for database
anomaly detection; compare on accuracy, performance, resource use, ease of
implementation; implement and test."*

> **Update:** the three models were benchmarked on labeled data — see
> [`ANOMALY_MODEL_BENCHMARK.md`](ANOMALY_MODEL_BENCHMARK.md). **Isolation Forest
> won for our workload and is now the primary detector** (Python sidecar,
> [`anomaly-service/`](../anomaly-service/)), with the modified z-score below as
> the graceful fallback.

DBWatch monitors an RDS instance whose signal is a set of **numeric metric
time-series** (CloudWatch: CPU, connections, freeable memory, free storage,
IOPS, latency; plus `pg_stat` counters). The data is low-volume, ~1 point/minute,
lagging ~a few minutes, and **unlabeled** (no ground-truth anomalies). That
context drives the comparison below.

---

## 1. Candidates compared

| # | Approach | Accuracy (this data) | Performance | Resource use | Ease |
|---|---|---|---|---|---|
| 1 | **Robust statistical — modified z-score (median + MAD)** | Good for point/spike anomalies on each metric | O(n log n) per metric, sub-ms | Tiny — pure JS, no service | Trivial |
| 2 | **Isolation Forest** (scikit-learn) | Better for *multivariate* anomalies (odd metric combinations) | Fast inference; training seconds | Needs a Python sidecar + sklearn | Moderate |
| 3 | **Time-series forecast residual** (Prophet / LSTM-autoencoder) | Best for *seasonal/trend* anomalies | Training slow (LSTM), heavier | Python + heavy deps (or GPU for LSTM) | Hard |

Notes:
- **Modified z-score** uses the median and MAD (median absolute deviation)
  instead of mean/stddev, so the outliers being detected don't inflate the
  baseline and hide themselves. Threshold 3.5 is the Iglewicz–Hoaglin standard.
- **Isolation Forest** shines when no single metric is out of range but the
  *combination* is unusual (e.g. high CPU + low connections). Needs enough
  history to be meaningful.
- **Forecast-residual** methods need seasonality and a decent history to learn;
  on a low-traffic single instance there's little seasonal signal, and the
  operational cost (training, extra service, deps) is high.

---

## 2. Decision

**Ship the modified z-score baseline first** (implemented), and keep Isolation
Forest as the documented next step.

Rationale (YAGNI + fit): most real DB alerts here are single-metric spikes
(CPU pegged, connections saturating, free storage dropping) — exactly what a
robust per-metric detector catches, with **zero new infrastructure** and
**deterministic, explainable** output. The heavier multivariate/seasonal
models add a Python service and dependencies for signal this dataset barely
has. We add them only if the baseline demonstrably misses real anomalies.

---

## 3. Implementation (shipped)

- `backend/anomaly.js` — pure `detectAnomalies(points, {threshold})` using
  median + MAD modified z-score. No dependencies. Has a runnable self-check
  (`node anomaly.js`) asserting it flags a spike, ignores a normal series, and
  needs a minimum number of points.
- `backend/routes/anomalies.js` — `GET /api/anomalies?minutes=N` runs the
  detector across every CloudWatch metric series and returns flagged points per
  metric (value, direction, z-score) + the baseline. Degrades to
  `{ available:false }` without AWS.
- **UI** — Infra Vitals shows an *Anomaly Detection* panel: total found, the
  method, and per-metric anomalous points, keyed to the same time-range selector
  as the charts.

---

## 4. Testing

- **Unit** — `node backend/anomaly.js` (synthetic spike, flat series,
  too-few-points) — passes.
- **Live** — against the RDS instance's CloudWatch metrics via
  `/api/anomalies`; a deliberate load spike (e.g. `SELECT pg_sleep` bursts or a
  connection flood) should surface on the CPU/connections metrics.

---

## 5. Next step — Isolation Forest (if needed)

If the baseline misses multivariate anomalies:
1. Add a small Python sidecar (`scikit-learn`) exposing `POST /score` that takes
   the recent metric matrix and returns per-point anomaly scores.
2. The Node backend calls it (feature-flagged), merging its scores with the
   statistical flags.
3. Optionally feed flagged windows to Gemini (`gemini.js`) for a natural-language
   explanation of *why* a period looks anomalous.

This keeps the lightweight default in place and adds ML only where it earns its
operational cost.
