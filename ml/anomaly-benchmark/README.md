# Anomaly-detection model benchmark

Empirically evaluates Isolation Forest, Local Outlier Factor, an MLP
Autoencoder, and DBWatch's shipped modified-z-score detector on real and
synthetic labeled data. Results + analysis: [`docs/ANOMALY_MODEL_BENCHMARK.md`](../../docs/ANOMALY_MODEL_BENCHMARK.md).

## Setup

```bash
pip install numpy pandas scikit-learn        # no TensorFlow needed

# fetch the real dataset (NAB — Numenta Anomaly Benchmark, AGPL; not vendored)
bash fetch_data.sh
```

## Run

```bash
python benchmark.py
```

Prints a Precision/Recall/F1/Accuracy/time table per dataset and a mean-F1
ranking across the real NAB series.

- `benchmark.py` — the experiment (models, metrics, synthetic generator).
- `data/` — NAB CSVs + labels, downloaded by `fetch_data.sh` (gitignored).
