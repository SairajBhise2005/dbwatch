# Anomaly Detection — Model Benchmark (measured)

This is the *empirical* companion to [`ANOMALY_DETECTION.md`](ANOMALY_DETECTION.md):
we actually trained and scored the three models from the research deck —
**Isolation Forest, Local Outlier Factor (LOF), Autoencoder** — plus DBWatch's
**shipped modified z-score (MAD)** detector, on labeled data.

Reproduce: [`ml/anomaly-benchmark/`](../ml/anomaly-benchmark/) → `python benchmark.py`.

## Datasets

1. **Real — NAB `realAWSCloudwatch`** (Numenta Anomaly Benchmark): genuine
   Amazon **RDS/EC2 CPU** time-series (~4,032 points each) with hand-labeled
   anomaly windows. Univariate; anomalies are *contextual/temporal*.
2. **Synthetic — DBWatch multivariate** (2,500 points): cpu, connections,
   query_time, cache_hit, mem_free, disk_io, txns, generated to mirror our
   metrics with **injected, labeled point anomalies** (CPU spikes, connection
   floods, slow-query/cache-miss, disk/txn storms).

Models are unsupervised; each is given the dataset's true anomaly fraction as
`contamination` for a fair separation comparison. The Autoencoder is an MLP
(`MLPRegressor`) trained to reconstruct standardized input — high reconstruction
error = anomaly (no TensorFlow needed).

## Results — real NAB (mean F1 across the 3 series)

| Method | Mean F1 |
|---|---|
| **Modified Z-score (shipped)** | **0.269** |
| Autoencoder (MLP) | 0.219 |
| Isolation Forest | 0.206 |
| Local Outlier Factor | 0.168 |

Representative single series (`rds_cpu_utilization_cc0c53`, 10% anomalous):

| Method | Prec | Recall | F1 | Acc | Time (ms) |
|---|---|---|---|---|---|
| Modified Z-score (shipped) | 0.30 | 0.76 | **0.43** | 0.80 | **5.7** |
| Autoencoder (MLP) | 0.34 | 0.34 | 0.34 | 0.87 | 4430 |
| Isolation Forest | 0.26 | 0.26 | 0.26 | 0.85 | 441 |
| Local Outlier Factor | 0.20 | 0.20 | 0.20 | 0.84 | 54 |

## Results — synthetic multivariate DB metrics (5% anomalous)

| Method | Prec | Recall | F1 | Acc | Time (ms) |
|---|---|---|---|---|---|
| **Isolation Forest** | 1.00 | 1.00 | **1.00** | 1.00 | 273 |
| Modified Z-score (shipped) | 0.98 | 1.00 | 0.99 | 1.00 | **1.4** |
| Autoencoder (MLP) | 0.82 | 0.82 | 0.82 | 0.98 | 2306 |
| Local Outlier Factor | 0.06 | 0.06 | 0.06 | 0.91 | 64 |

## What the numbers say

- **Real contextual anomalies are hard for point detection.** On NAB (anomalies
  are *time windows*, not isolated points), every method scores low F1
  (0.14–0.43). Our lightweight **z-score is actually the best on mean F1** —
  high recall, lower precision (it flags broadly). Honest takeaway: none of
  these point models is a silver bullet for contextual/seasonal anomalies;
  that needs forecasting-residual methods (Prophet/LSTM), which are heavier.
- **Multivariate point anomalies (our real use case) strongly favor Isolation
  Forest** — a perfect F1 here, and it catches odd *combinations* of metrics a
  per-metric z-score can miss. The z-score is a hair behind (0.99) and ~200×
  faster.
- **LOF is a poor fit** for our data: it targets *local density* outliers, but
  our anomalies are global spikes → F1 0.06 on synthetic. It would only help
  for clustered behavioral data (e.g. login/session patterns).
- **Autoencoder** is decent but the slowest (2–4 s) and needs ample history;
  overkill for a single small instance.
- **Speed:** z-score ~1–6 ms, LOF ~40–64 ms, Isolation Forest ~270–440 ms,
  Autoencoder ~2.3–4.4 s.

## Recommendation

1. **Keep the modified z-score** as the always-on, real-time default — fastest,
   explainable, competitive everywhere, best on the real contextual data.
2. **Add Isolation Forest** as an optional multivariate detector (perfect on
   our synthetic point anomalies; catches metric-combination anomalies). This is
   the deck's Phase-1 ML step and the clear ML win for our workload.
3. **Skip LOF** for infrastructure metrics (wrong anomaly type); reconsider only
   for behavioral/session data.
4. **Defer the Autoencoder** until there's substantial history and a need for
   complex temporal patterns — accuracy doesn't justify the cost here yet.

## What shipped

Recommendations 1 + 2 are now live. Isolation Forest is the **primary**
detector, running as a Python sidecar ([`anomaly-service/`](../anomaly-service/));
`GET /api/anomalies` calls it multivariately (all CloudWatch metrics at once)
and returns each flagged timestamp with the metrics that drove it. If the
sidecar is unreachable, the backend **falls back** to the built-in modified
z-score ([`backend/anomaly.js`](../backend/anomaly.js)), grouping per-metric
flags by timestamp into the same shape — so the dashboard always works. The
Cloud page badges which engine produced the result (`Isolation Forest (ML)`
vs `z-score fallback`).

## Caveats

- Unsupervised models were given the true anomaly fraction (`contamination`);
  in production that's estimated, so live precision/recall will differ.
- NAB series are univariate; we engineered rolling features (mean/std/residual/
  delta) to give the models temporal context.
- Numbers are from `random_state=42`; small run-to-run variation is expected for
  the MLP.
