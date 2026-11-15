#!/usr/bin/env node
/**
 * Challenge Drop 3 — SOS flood / spam attack simulation.
 *
 * Runs against a server with its DEFAULT protection settings (no raised limits):
 *   DB_FILE=off npm start                                   (server, port 4000)
 *   node scripts/flood-test.mjs --url http://localhost:4000
 *
 * All traffic below runs AT THE SAME TIME:
 *   Bot A  — one source IP, mints guest tokens and fires 300 SOS            (rate limiting)
 *   Bot B  — 300 "distributed" sources (X-Forwarded-For), scripted identical
 *            coordinates, 1 SOS each                                         (bot scoring → quarantine)
 *   Bot C  — one token replays the same SOS 100 times                        (duplicate filter / rate limit)
 *   Legit  — 40 real citizens, own IPs, own positions, 1 SOS each            (must get 201, not quarantined)
 *   Dispatcher — polls the panel and dispatches the nearest brigade           (must stay responsive)
 *
 * The distinct sources are simulated with X-Forwarded-For, which the server trusts only
 * from loopback (TRUST_PROXY=loopback) — so run this on the same machine as the server.
 * Exit code 1 if average latency ≥ 300 ms, a legit SOS was lost/quarantined, or the panel failed.
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
const BOT_A = Number(args.botA ?? 300);
const BOT_B = Number(args.botB ?? 300);
const BOT_C = Number(args.botC ?? 100);
const LEGIT = Number(args.legit ?? 40);
const HAZARDS = ['fire', 'collapse', 'flood', 'medical'];

const lat = { botA: [], botB: [], botC: [], legit: [], dispatcher: [], all: [] };
const codes = {};
const count = (group, status) => {
  codes[group] ??= {};
  codes[group][status] = (codes[group][status] ?? 0) + 1;
};

async function call(group, path, { method = 'POST', body, token, ip, headers = {} } = {}) {
  const s = performance.now();
  let status = 0;
  let data = null;
  try {
    const r = await fetch(`${URL_}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}), ...headers },
      body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
    });
    status = r.status;
    data = await r.json().catch(() => null);
  } catch {
    status = 'ERR';
  }
  const ms = performance.now() - s;
  lat[group].push(ms);
  lat.all.push(ms);
  count(group, status);
  return { status, data };
}

async function pool(n, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < n) await fn(i++); }));
}

const stats = (a) => {
  if (!a.length) return { n: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  const p = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1), p50: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

// ---------- setup ----------
const login = await fetch(`${URL_}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dispatcher', password: 'dispatcher123' }) });
const op = (await login.json()).token;
if (!op) {
  console.error('Dispatcher login failed — is the server running at', URL_, '?');
  process.exit(2);
}
const before = await (await fetch(`${URL_}/api/health`)).json();
console.log(`PaniGo SOS-flood test → ${URL_}`);
console.log(`fake SOS: botA=${BOT_A} (1 IP) + botB=${BOT_B} (distributed) + botC=${BOT_C} (replay) = ${BOT_A + BOT_B + BOT_C}; legit=${LEGIT}\n`);

const legitIds = [];
let flooding = true;
const t0 = performance.now();

const botA = (async () => {
  const ip = '203.0.113.7';
  const tokens = [];
  for (let i = 0; i < 30; i++) {
    const r = await call('botA', '/auth/guest', { ip });
    if (r.data?.token) tokens.push(r.data.token);
  }
  if (!tokens.length) return;
  await pool(BOT_A, 50, (i) => call('botA', '/citizen/sos', { token: tokens[i % tokens.length], ip, body: { hazard: HAZARDS[i % 4], location: { lat: 40.37 + Math.random() * 0.05, lng: 49.8 + Math.random() * 0.1 } } }));
})();

const botB = pool(BOT_B, 60, async (i) => {
  const ip = `198.18.${i >> 8}.${i & 255}`;
  const g = await call('botB', '/auth/guest', { ip });
  if (!g.data?.token) return;
  await call('botB', '/citizen/sos', { token: g.data.token, ip, body: { hazard: 'collapse', location: { lat: 40.3889, lng: 49.8413 } } });
});

const botC = (async () => {
  const ip = '192.0.2.99';
  const g = await call('botC', '/auth/guest', { ip });
  await pool(BOT_C, 20, () => call('botC', '/citizen/sos', { token: g.data?.token, ip, body: { hazard: 'fire', location: { lat: 40.405, lng: 49.86 } } }));
})();

const legit = pool(LEGIT, 10, async (i) => {
  const ip = `100.64.${i >> 8}.${i & 255}`;
  const g = await call('legit', '/auth/guest', { ip });
  await new Promise((r) => setTimeout(r, Math.random() * 1500)); // a person needs a moment
  const r = await call('legit', '/citizen/sos', {
    token: g.data?.token,
    ip,
    headers: { 'Idempotency-Key': `legit-${i}-${Date.now()}` },
    body: { hazard: HAZARDS[i % 4], location: { lat: 40.36 + Math.random() * 0.08, lng: 49.78 + Math.random() * 0.17 } },
  });
  if (r.status === 201) legitIds.push(r.data.id);
});

let panelErrors = 0;
let dispatched = 0;
const dispatcher = (async () => {
  while (flooding) {
    const s = await call('dispatcher', '/dispatch/snapshot', { method: 'GET', token: op });
    if (s.status !== 200) panelErrors++;
    const target = s.data?.sos?.find((x) => x.status === 'new' && legitIds.includes(x.id));
    if (target && dispatched < 5) {
      const a = await call('dispatcher', `/dispatch/sos/${target.id}/assign-nearest`, { token: op });
      if (a.status === 200) dispatched++;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();

await Promise.all([botA, botB, botC, legit]);
const floodMs = performance.now() - t0;
flooding = false;
await dispatcher;

// ---------- verification ----------
const health = await (await fetch(`${URL_}/api/health`)).json();
const quarantine = await (await fetch(`${URL_}/api/dispatch/quarantine`, { headers: { Authorization: `Bearer ${op}` } })).json();
const snap = await (await fetch(`${URL_}/api/dispatch/snapshot`, { headers: { Authorization: `Bearer ${op}` } })).json();
const quarantinedLegit = legitIds.filter((id) => quarantine.items.some((q) => q.id === id)).length;
const legitInFeed = legitIds.filter((id) => snap.sos.some((s) => s.id === id)).length;
const recent = snap.alerts.filter((a) => a.kind === 'sos_cluster' && a.createdAt >= Date.now() - floodMs - 5000);
const clusterAlerts = recent.length;
const botOnlyAlerts = recent.filter((a) => !a.sosIds.some((id) => legitIds.includes(id))).length;

console.log('HTTP status codes by source:');
for (const [g, c] of Object.entries(codes)) console.log(`  ${g.padEnd(11)} ${JSON.stringify(c)}`);
console.log('\nClient-side latency (ms):');
for (const g of ['botA', 'botB', 'botC', 'legit', 'dispatcher', 'all']) {
  const s = stats(lat[g]);
  console.log(`  ${g.padEnd(11)} n=${String(s.n).padStart(4)}  avg=${String(s.avg).padStart(6)}  p50=${String(s.p50).padStart(6)}  p95=${String(s.p95).padStart(6)}  max=${String(s.max).padStart(7)}`);
}
const g = health.guard;
const d = (k) => g[k] - (before.guard?.[k] ?? 0);
console.log(`\nServer-side (last 60 s): avg=${health.latency.avgMs} ms  p95=${health.latency.p95Ms} ms  over ${health.latency.count} requests`);
console.log(`Guard: accepted=${d('accepted')} duplicates=${d('duplicates')} quarantined=${d('quarantined')} rateLimited(SOS)=${d('rateLimited')} underAttack=${g.underAttack}`);
console.log(`Legit citizens: ${legitIds.length}/${LEGIT} accepted, ${legitInFeed} visible to dispatcher, ${quarantinedLegit} quarantined`);
console.log(`Dispatcher: ${lat.dispatcher.length} panel calls, ${panelErrors} failures, ${dispatched} brigades dispatched during the flood`);
console.log(`SOS-cluster alerts during the flood: ${clusterAlerts} (driven by real citizens), ${botOnlyAlerts} made only of bot traffic`);
console.log(`Duration: ${(floodMs / 1000).toFixed(1)} s, ${Math.round(lat.all.length / (floodMs / 1000))} req/s`);

const avg = stats(lat.all).avg;
const ok = avg < 300 && health.latency.avgMs < 300 && legitIds.length === LEGIT && quarantinedLegit === 0 && legitInFeed === LEGIT && panelErrors === 0 && botOnlyAlerts === 0;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — average latency ${avg} ms (client) / ${health.latency.avgMs} ms (server), target < 300 ms`);
process.exit(ok ? 0 : 1);
