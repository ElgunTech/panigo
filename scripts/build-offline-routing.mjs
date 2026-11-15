#!/usr/bin/env node
/**
 * Offline routing backup (Challenge Drop 2).
 *
 *   node scripts/build-offline-routing.mjs
 *
 * While the external routing API is still healthy, pre-compute a local backup that the
 * server uses when the API is down (HTTP 503 / > 5 s):
 *  1. Static coordinate matrix — real pedestrian distance & duration from a ~1.3 km grid of
 *     anchor points (+ district centres) to every assembly point / metro exit (OSRM Table API).
 *  2. Route-cache seed — full route geometries from each district centre to its 6 nearest
 *     targets, so cached routes exist even on a fresh start.
 * Output: server/src/data/offline-routing.json (committed → works without internet).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'server/src/data/offline-routing.json');
const OSRM = process.env.OSRM_FOOT_URL ?? 'https://routing.openstreetmap.de/routed-foot';
const UA = { 'User-Agent': 'panigo-prototype/1.0 (educational)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- same coastline as server/src/domain/roadNetwork.ts (anchors must be on land) ---
const COAST = [[49.79, 40.29], [49.83, 40.3], [49.842, 40.325], [49.848, 40.355], [49.86, 40.367], [49.88, 40.371], [49.9, 40.373], [49.92, 40.365], [49.94, 40.355], [49.98, 40.35]];
function coastLat(lng) {
  if (lng <= COAST[0][0]) return COAST[0][1];
  for (let i = 1; i < COAST.length; i++) if (lng <= COAST[i][0]) return COAST[i - 1][1] + ((lng - COAST[i - 1][0]) / (COAST[i][0] - COAST[i - 1][0])) * (COAST[i][1] - COAST[i - 1][1]);
  return COAST[COAST.length - 1][1];
}
const onLand = (p) => p.lat >= coastLat(p.lng) + 0.002;
const r5 = (n) => +n.toFixed(5);

// --- targets: where citizens are routed to (assembly points + official metro exits) ---
const osm = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/src/data/baku-osm.json'), 'utf8'));
const odaz = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/src/data/opendata-az.json'), 'utf8'));
const targets = [
  ...osm.points.filter((p) => p.type !== 'shelter').map((p) => p.location),
  ...Object.values(odaz.metroExits).flatMap((m) => m.exits.map((e) => ({ lat: e.lat, lng: e.lng }))),
  ...odaz.venues.map((v) => v.location),
].map((p) => ({ lat: r5(p.lat), lng: r5(p.lng) }));

// --- anchors: district centres + land grid ---
const centres = [
  [40.3655, 49.8352], [40.3875, 49.8395], [40.3925, 49.8135], [40.4075, 49.8705],
  [40.3835, 49.9045], [40.4035, 49.9365], [40.43, 49.83], [40.428, 49.93],
].map(([lat, lng]) => ({ lat, lng }));
const anchors = [...centres];
for (let lat = 40.358; lat <= 40.44; lat += 0.012) for (let lng = 49.8; lng <= 49.97; lng += 0.016) {
  const p = { lat: r5(lat), lng: r5(lng) };
  if (onLand(p)) anchors.push(p);
}
console.log(`anchors=${anchors.length} targets=${targets.length}`);

async function table(srcs, dsts, attempt = 1) {
  const coords = [...srcs, ...dsts].map((p) => `${p.lng},${p.lat}`).join(';');
  const s = srcs.map((_, i) => i).join(';');
  const d = dsts.map((_, i) => i + srcs.length).join(';');
  try {
    const res = await fetch(`${OSRM}/table/v1/foot/${coords}?sources=${s}&destinations=${d}&annotations=distance,duration`, { headers: UA, signal: AbortSignal.timeout(60000) });
    const j = await res.json();
    if (j.code !== 'Ok') throw new Error(j.code);
    return j;
  } catch (e) {
    if (attempt >= 4) throw e;
    await sleep(2000 * attempt);
    return table(srcs, dsts, attempt + 1);
  }
}

// 1) Static matrix (batched: 20 sources × 60 destinations per call)
const distances = anchors.map(() => new Array(targets.length).fill(null));
const durations = anchors.map(() => new Array(targets.length).fill(null));
for (let a = 0; a < anchors.length; a += 20) {
  for (let t = 0; t < targets.length; t += 60) {
    const j = await table(anchors.slice(a, a + 20), targets.slice(t, t + 60));
    j.distances.forEach((row, i) => row.forEach((v, k) => (distances[a + i][t + k] = v === null ? null : Math.round(v))));
    j.durations.forEach((row, i) => row.forEach((v, k) => (durations[a + i][t + k] = v === null ? null : Math.round(v))));
    process.stdout.write('.');
    await sleep(300);
  }
}
console.log('\n✓ matrix', anchors.length, '×', targets.length);

// 2) Route-cache seed: each district centre → its 6 nearest targets
const hav = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * 0.76) * 111000;
const routes = [];
for (const c of centres) {
  const near = [...targets].sort((x, y) => hav(c, x) - hav(c, y)).slice(0, 6);
  for (const t of near) {
    try {
      const res = await fetch(`${OSRM}/route/v1/foot/${c.lng},${c.lat};${t.lng},${t.lat}?overview=simplified&geometries=geojson`, { headers: UA, signal: AbortSignal.timeout(20000) });
      const j = await res.json();
      if (j.code === 'Ok') {
        const r = j.routes[0];
        routes.push({ profile: 'standard', from: c, to: t, distanceM: Math.round(r.distance), durationS: Math.round(r.duration), geometry: r.geometry.coordinates.map(([lng, lat]) => ({ lat: r5(lat), lng: r5(lng) })) });
      }
    } catch {
      /* skip */
    }
    await sleep(250);
  }
}
console.log('✓ cached routes', routes.length);

fs.writeFileSync(OUT, JSON.stringify({ source: `OSRM foot (${OSRM}) — OpenStreetMap data`, generatedAt: new Date().toISOString(), anchors, targets, distances, durations, routes }));
console.log('✓ wrote', path.relative(ROOT, OUT), `${Math.round(fs.statSync(OUT).size / 1024)} KB`);
