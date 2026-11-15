#!/usr/bin/env node
/**
 * SOS load test — simulates a burst of citizens sending SOS at the same time.
 *
 *   RATE_LIMIT_PER_MIN=1000000 AUTH_RATE_LIMIT_PER_MIN=1000000 npm start   (server)
 *   node scripts/loadtest.mjs --url http://localhost:4000 --citizens 500 --concurrency 100
 *
 * Reports throughput and latency percentiles; exits non-zero if the error rate > 1%.
 */
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split('--')
    .filter(Boolean)
    .map((s) => s.trim().split(/\s+/)),
);
const URL_ = args.url ?? 'http://localhost:4000';
const N = Number(args.citizens ?? 500);
const C = Number(args.concurrency ?? 100);
const HAZARDS = ['fire', 'collapse', 'flood', 'medical'];

async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

console.log(`UCE load test → ${URL_}  citizens=${N} concurrency=${C}`);
const tokens = await pool(Array.from({ length: N }), C, async () => {
  const r = await fetch(`${URL_}/api/auth/guest`, { method: 'POST' });
  return (await r.json()).token;
});

const lat = [];
let errors = 0;
const t0 = performance.now();
await pool(tokens, C, async (token, i) => {
  const body = {
    hazard: HAZARDS[i % 4],
    location: { lat: 40.37 + Math.random() * 0.06, lng: 49.8 + Math.random() * 0.15 },
  };
  const s = performance.now();
  try {
    const r = await fetch(`${URL_}/api/citizen/sos`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (r.status !== 201) errors++;
  } catch {
    errors++;
  }
  lat.push(performance.now() - s);
});
const total = (performance.now() - t0) / 1000;
lat.sort((a, b) => a - b);

const result = {
  requests: N,
  errors,
  errorRate: `${((errors / N) * 100).toFixed(2)}%`,
  durationS: +total.toFixed(2),
  throughputRps: Math.round(N / total),
  latencyMs: { p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1), max: +lat[lat.length - 1].toFixed(1) },
};
console.log(JSON.stringify(result, null, 2));
process.exit(errors / N > 0.01 ? 1 : 0);
