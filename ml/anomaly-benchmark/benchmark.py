#!/usr/bin/env python3
"""
Anomaly-detection model benchmark for DBWatch.

Evaluates the three models from the research deck — Isolation Forest,
Local Outlier Factor, Autoencoder — plus DBWatch's shipped statistical
detector (robust modified z-score / MAD), on:

  1. REAL data  — NAB realAWSCloudwatch RDS/EC2 CPU series with hand-labeled
                  anomaly windows (Numenta Anomaly Benchmark).
  2. SYNTHETIC  — a multivariate DB-metrics stream generated to mirror
                  DBWatch (cpu, memory, connections, query_time, cache_hit,
                  disk_io, txns) with injected, labeled anomalies.

Metrics: Precision / Recall / F1 / Accuracy on the anomaly class, plus
fit+predict wall time. Unsupervised models get each dataset's true anomaly
fraction as `contamination` for a fair separation comparison.

No TensorFlow: the Autoencoder is an MLP (sklearn MLPRegressor) trained to
reconstruct its input; high reconstruction error = anomaly.

Run:  python benchmark.py
"""
import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.neural_network import MLPRegressor
from sklearn.metrics import precision_recall_fscore_support, accuracy_score

warnings.filterwarnings("ignore")
np.random.seed(42)

DATA = Path(__file__).parent / "data"
ROLL = 12  # rolling window (~1h at 5-min cadence)


# ─────────────────────────── datasets ───────────────────────────
def ts_features(values: pd.Series) -> pd.DataFrame:
    """Turn a univariate series into a small temporal feature matrix."""
    v = values.astype(float)
    mean = v.rolling(ROLL, min_periods=1).mean()
    std = v.rolling(ROLL, min_periods=1).std().fillna(0)
    return pd.DataFrame({
        "value": v,
        "roll_mean": mean,
        "roll_std": std,
        "residual": v - mean,
        "delta": v.diff().fillna(0),
    })


def load_nab(csv_name: str, windows: dict):
    df = pd.read_csv(DATA / csv_name)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    key = f"realAWSCloudwatch/{csv_name}"
    y = np.zeros(len(df), dtype=int)
    for start, end in windows.get(key, []):
        s, e = pd.to_datetime(start), pd.to_datetime(end)
        y[(df["timestamp"] >= s) & (df["timestamp"] <= e)] = 1
    return ts_features(df["value"]), y


def make_synthetic(n=2500, anomaly_frac=0.05):
    """Multivariate DB metrics mirroring DBWatch, with injected anomalies."""
    rng = np.random.default_rng(7)
    # normal correlated baseline
    cpu = np.clip(rng.normal(25, 6, n), 1, 100)
    conns = np.clip(rng.normal(20, 5, n) + cpu * 0.2, 1, 200)
    qtime = np.clip(rng.normal(30, 8, n) + cpu * 0.3, 1, None)  # ms
    cache = np.clip(rng.normal(99, 0.4, n), 80, 100)
    mem_free = np.clip(rng.normal(400, 40, n) - cpu, 20, 1024)  # MB
    disk_io = np.clip(rng.normal(50, 12, n) + cpu * 0.5, 0, None)
    txns = np.clip(rng.normal(120, 25, n) + cpu, 0, None)
    df = pd.DataFrame({"cpu": cpu, "connections": conns, "query_time": qtime,
                       "cache_hit": cache, "mem_free": mem_free,
                       "disk_io": disk_io, "txns": txns})
    y = np.zeros(n, dtype=int)
    idx = rng.choice(n, size=int(n * anomaly_frac), replace=False)
    for i in idx:
        kind = rng.integers(0, 4)
        if kind == 0:      # CPU spike
            df.loc[i, ["cpu", "disk_io", "query_time"]] *= [3.5, 2.5, 2.0]
        elif kind == 1:    # connection flood
            df.loc[i, ["connections", "mem_free"]] = [df.connections[i] * 4, df.mem_free[i] * 0.15]
        elif kind == 2:    # slow queries + cache miss
            df.loc[i, ["query_time", "cache_hit"]] = [df.query_time[i] * 6, 70]
        else:              # disk / txn storm
            df.loc[i, ["disk_io", "txns"]] *= [4.0, 3.0]
        y[i] = 1
    return df, y


# ─────────────────────────── models ───────────────────────────
def modified_zscore(X_raw: pd.DataFrame, thresh=3.5):
    """DBWatch's shipped detector: per-column median + MAD, flag any-exceed."""
    flags = np.zeros(len(X_raw), dtype=bool)
    for col in X_raw.columns:
        v = X_raw[col].to_numpy(float)
        med = np.median(v)
        mad = np.median(np.abs(v - med))
        if mad == 0:
            continue
        z = 0.6745 * (v - med) / mad
        flags |= np.abs(z) >= thresh
    return flags.astype(int)


def run_all(X_raw: pd.DataFrame, y: np.ndarray):
    rate = max(y.mean(), 0.005)
    Xs = StandardScaler().fit_transform(X_raw.to_numpy(float))
    out = {}

    def timed(fn):
        t = time.perf_counter()
        pred = fn()
        return pred, (time.perf_counter() - t) * 1000  # ms

    # DBWatch shipped: modified z-score
    out["Modified Z-score (shipped)"] = timed(lambda: modified_zscore(X_raw))

    # Isolation Forest
    out["Isolation Forest"] = timed(
        lambda: (IsolationForest(contamination=rate, random_state=42, n_estimators=150)
                 .fit_predict(Xs) == -1).astype(int))

    # Local Outlier Factor
    out["Local Outlier Factor"] = timed(
        lambda: (LocalOutlierFactor(contamination=rate, n_neighbors=20)
                 .fit_predict(Xs) == -1).astype(int))

    # Autoencoder (MLP reconstruction error)
    def autoencoder():
        ae = MLPRegressor(hidden_layer_sizes=(max(4, Xs.shape[1]), 2, max(4, Xs.shape[1])),
                          activation="tanh", max_iter=400, random_state=42)
        ae.fit(Xs, Xs)
        err = np.mean((Xs - ae.predict(Xs)) ** 2, axis=1)
        return (err >= np.quantile(err, 1 - rate)).astype(int)
    out["Autoencoder (MLP)"] = timed(autoencoder)

    rows = {}
    for name, (pred, ms) in out.items():
        p, r, f1, _ = precision_recall_fscore_support(
            y, pred, average="binary", pos_label=1, zero_division=0)
        rows[name] = dict(precision=p, recall=r, f1=f1,
                          accuracy=accuracy_score(y, pred), ms=ms)
    return rows, rate


def print_table(title, rows, rate, n):
    print(f"\n=== {title}  (n={n}, anomalies={rate*100:.1f}%) ===")
    print(f"{'Method':<28}{'Prec':>7}{'Recall':>8}{'F1':>7}{'Acc':>8}{'Time(ms)':>10}")
    print("-" * 68)
    for name, m in rows.items():
        print(f"{name:<28}{m['precision']:>7.2f}{m['recall']:>8.2f}{m['f1']:>7.2f}"
              f"{m['accuracy']:>8.2f}{m['ms']:>10.1f}")


def main():
    windows = json.load(open(DATA / "combined_windows.json"))
    nab_files = ["rds_cpu_utilization_cc0c53.csv",
                 "rds_cpu_utilization_e47b3b.csv",
                 "ec2_cpu_utilization_24ae8d.csv"]

    agg = {}  # method -> list of f1 across real datasets
    for f in nab_files:
        X, y = load_nab(f, windows)
        rows, rate = run_all(X, y)
        print_table(f"REAL · NAB {f}", rows, rate, len(y))
        for name, m in rows.items():
            agg.setdefault(name, []).append(m["f1"])

    Xs, ys = make_synthetic()
    rows, rate = run_all(Xs, ys)
    print_table("SYNTHETIC · DBWatch multivariate metrics", rows, rate, len(ys))

    print("\n=== MEAN F1 across the 3 REAL NAB series ===")
    for name, f1s in sorted(agg.items(), key=lambda kv: -np.mean(kv[1])):
        print(f"  {name:<28}{np.mean(f1s):.3f}")


if __name__ == "__main__":
    main()
