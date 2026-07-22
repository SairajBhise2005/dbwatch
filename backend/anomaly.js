// anomaly.js — statistical anomaly detection over a metric time-series.
//
// Uses the robust MODIFIED Z-SCORE (median + MAD) rather than mean/stddev:
// the median and MAD aren't dragged around by the very outliers we're
// trying to find, so a single spike doesn't hide itself. Threshold 3.5 is
// the conventional cutoff (Iglewicz & Hoaglin). No dependencies — see
// docs/ANOMALY_DETECTION.md for the comparison vs Isolation Forest etc.

const MAD_TO_SIGMA = 0.6745; // scales MAD to a std-dev-equivalent

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {{t:string, v:number|null}[]} points
 * @param {{threshold?:number, minPoints?:number}} [opts]
 * @returns {{baseline:{median:number,mad:number}|null, anomalies:{t,v,score,direction}[]}}
 */
export function detectAnomalies(points, opts = {}) {
  const { threshold = 3.5, minPoints = 8 } = opts;
  const vals = (points || []).map((p) => p.v).filter((v) => v != null);
  if (vals.length < minPoints) return { baseline: null, anomalies: [] };

  const med = median(vals);
  const mad = median(vals.map((v) => Math.abs(v - med)));
  const anomalies = [];
  // With zero MAD the series is basically constant → only exact-different
  // points are anomalies; skip scoring to avoid divide-by-zero noise.
  if (mad > 0) {
    for (const p of points) {
      if (p.v == null) continue;
      const score = (MAD_TO_SIGMA * (p.v - med)) / mad;
      if (Math.abs(score) >= threshold) {
        anomalies.push({ t: p.t, v: p.v, score: round(score), direction: score > 0 ? 'high' : 'low' });
      }
    }
  }
  return { baseline: { median: round(med), mad: round(mad) }, anomalies };
}

// ── runnable self-check: `node anomaly.js` ──
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const assert = (c, m) => {
    if (!c) throw new Error('FAIL: ' + m);
  };
  // flat-ish baseline ~10 with one obvious spike at 100
  const base = Array.from({ length: 20 }, (_, i) => ({ t: `${i}`, v: 10 + (i % 3) }));
  const spiked = [...base, { t: 'x', v: 100 }];
  const r = detectAnomalies(spiked);
  assert(r.anomalies.length === 1, 'should flag exactly the spike');
  assert(r.anomalies[0].v === 100 && r.anomalies[0].direction === 'high', 'spike is high');

  const flat = detectAnomalies(base);
  assert(flat.anomalies.length === 0, 'no anomalies in normal series');

  const tooFew = detectAnomalies([{ t: '1', v: 5 }, { t: '2', v: 900 }]);
  assert(tooFew.anomalies.length === 0, 'needs enough points before flagging');

  console.log('anomaly.js self-check passed');
}
