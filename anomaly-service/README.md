# anomaly-service — Isolation Forest sidecar

DBWatch's **primary** anomaly detector. Runs multivariate Isolation Forest
(the model the [benchmark](../docs/ANOMALY_MODEL_BENCHMARK.md) picked) over the
CloudWatch metric series and returns flagged timestamps with the metrics that
drove each. The Node backend calls it; if it's down, the backend falls back to
its built-in modified z-score — so detection degrades gracefully.

- `detector.py` — scoring core (framework-free, self-tested: `python detector.py`).
- `app.py` — thin Flask wrapper (`POST /score`, `GET /health`).
- Runs in `docker-compose.yml` as `anomaly-service` (internal only, port 8000).

```
POST /score  { metrics: { key: { label, unit, points:[{t,v}] } }, contamination? }
          ->  { available, method, anomalies:[{ t, score, contributors:[{key,value,z}] }] }
```

Backend targets it via `ANOMALY_SERVICE_URL` (default `http://anomaly-service:8000`).
