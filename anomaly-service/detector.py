"""
Multivariate Isolation Forest scoring — the model the benchmark picked for
DBWatch's data (docs/ANOMALY_MODEL_BENCHMARK.md). Pure function, no web
framework, so it runs and tests standalone: `python detector.py`.
"""
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

MIN_ROWS = 12  # need a bit of history before scoring


def score_metrics(metrics, contamination=0.05):
    """
    metrics: { key: { label, unit, points:[{t, v}] } }
    -> { available, method, anomalies:[{ t, score, contributors:[{key,value,z}] }] }
       or { available: False, reason }
    """
    keys = [k for k in metrics if (metrics[k] or {}).get("points")]
    if not keys:
        return {"available": False, "reason": "no metrics"}

    # Align points by timestamp (CloudWatch shares a period grid across metrics).
    by_time = {}
    for k in keys:
        for p in metrics[k]["points"]:
            v = p.get("v")
            if v is None:
                continue
            by_time.setdefault(p["t"], {})[k] = v
    times = sorted(by_time)
    if len(times) < MIN_ROWS:
        return {"available": False, "reason": "not enough data"}

    # Matrix rows=timestamps, cols=metrics; impute gaps with the column median.
    X = np.full((len(times), len(keys)), np.nan)
    for i, t in enumerate(times):
        for j, k in enumerate(keys):
            if k in by_time[t]:
                X[i, j] = by_time[t][k]
    for j in range(X.shape[1]):
        col = X[:, j]
        med = np.nanmedian(col)
        col[np.isnan(col)] = 0.0 if np.isnan(med) else med

    Xs = StandardScaler().fit_transform(X)
    contamination = float(min(max(contamination or 0.05, 0.005), 0.5))

    model = IsolationForest(contamination=contamination, n_estimators=150, random_state=42)
    pred = model.fit_predict(Xs)      # -1 = anomaly
    sev = -model.score_samples(Xs)    # higher = more anomalous

    anomalies = []
    for i, t in enumerate(times):
        if pred[i] != -1:
            continue
        # Attribute the anomaly to the metrics deviating most at this row.
        contribs = [
            {"key": keys[j], "value": float(X[i, j]), "z": round(float(Xs[i, j]), 2)}
            for j in range(len(keys))
            if abs(Xs[i, j]) >= 1.5
        ]
        contribs.sort(key=lambda c: -abs(c["z"]))
        anomalies.append({"t": t, "score": round(float(sev[i]), 3), "contributors": contribs[:4]})

    anomalies.sort(key=lambda a: -a["score"])
    return {"available": True, "method": "Isolation Forest", "anomalies": anomalies}


# ── runnable self-check: `python detector.py` ──
if __name__ == "__main__":
    rng = np.random.default_rng(0)
    n = 200
    pts = lambda vals: [{"t": f"2026-01-01T00:{i:02d}:00Z", "v": float(vals[i])} for i in range(n)]
    cpu = rng.normal(25, 4, n)
    conn = rng.normal(20, 3, n)
    qtime = rng.normal(30, 5, n)
    # inject a clear multivariate anomaly at row 150
    cpu[150], conn[150], qtime[150] = 95, 90, 220
    metrics = {
        "cpu": {"label": "CPU", "unit": "Percent", "points": pts(cpu)},
        "connections": {"label": "Conns", "unit": "Count", "points": pts(conn)},
        "query_time": {"label": "Query time", "unit": "ms", "points": pts(qtime)},
    }
    out = score_metrics(metrics, contamination=0.05)
    assert out["available"], out
    flagged = {a["t"] for a in out["anomalies"]}
    target = f"2026-01-01T00:{150:02d}:00Z"  # the injected row
    assert target in flagged, "should flag the injected multivariate anomaly (row 150)"
    top = out["anomalies"][0]
    assert top["contributors"], "anomaly should name contributing metrics"

    # too little data -> gracefully unavailable
    short = {"cpu": {"label": "CPU", "unit": "%", "points": pts(cpu)[:5]}}
    assert score_metrics(short)["available"] is False, "needs enough rows"

    print("detector.py self-check passed:", len(out["anomalies"]), "anomalies flagged")
