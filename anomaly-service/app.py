"""
DBWatch anomaly-detection sidecar — multivariate Isolation Forest.

The Node backend POSTs the CloudWatch metric series here; this service runs
Isolation Forest (the model the benchmark picked for multivariate DB point
anomalies) and returns flagged timestamps with the metrics that drove each.
If this service is down, the Node backend falls back to its built-in
modified z-score detector — so anomaly detection degrades gracefully.

POST /score  { metrics: { key: { label, unit, points:[{t,v}] } }, contamination? }
          ->  { available, method, anomalies:[{ t, score, contributors:[{key,value,z}] }] }
GET  /health

Scoring lives in detector.py (framework-free, self-tested).
"""
from flask import Flask, request, jsonify
from detector import score_metrics

app = Flask(__name__)


@app.get("/health")
def health():
    return {"ok": True, "model": "IsolationForest"}


@app.post("/score")
def score():
    body = request.get_json(force=True, silent=True) or {}
    return jsonify(score_metrics(body.get("metrics") or {}, body.get("contamination")))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
