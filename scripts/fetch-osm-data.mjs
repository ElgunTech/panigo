#!/usr/bin/env node
/**
 * Real-world data import for Baku from OpenStreetMap (Overpass API, ODbL licence).
 *
 *   node scripts/fetch-osm-data.mjs
 *
 * Produces server/src/data/baku-osm.json, which the server loads at start-up
 * (with a hand-curated fallback in seed.ts if the file is missing). The file
 * is committed so the demo works fully offline — the import is reproducible.
 *
 * Capacity heuristics (documented in docs/DATA.md):
 *  - Metro station (deep civil-defence structure): 1 500 people
 *  - Park / open space: usable 50% of area at 2 m² per person, clamped 500..20 000
 *  - Stadium: OSM `capacity` tag, else 5 000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'server/src/data/baku-osm.json');
const BBOX = '40.345,49.770,40.460,49.990'; // S,W,N,E — central Baku operational area
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Features with full polygon geometry (so the marker is guaranteed to lie INSIDE
// the park/stadium — a bounding-box centre of a curved coastal park falls into the sea).
const QUERY = `[out:json][timeout:120];
(
  node["station"="subway"](${BBOX});
  node["railway"="station"]["subway"="yes"](${BBOX});
  way["leisure"="park"]["name"](${BBOX});
  relation["leisure"="park"]["name"](${BBOX});
  way["leisure"="stadium"]["name"](${BBOX});
  relation["leisure"="stadium"]["name"](${BBOX});
  nwr["amenity"="fire_station"](${BBOX});
  nwr["amenity"="hospital"]["name"](${BBOX});
  way["highway"="steps"](${BBOX});
  way["highway"="footway"]["tunnel"="yes"](${BBOX});
  way["highway"="footway"]["layer"="-1"](${BBOX});
)->.features;
.features out geom tags;
relation["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]["name"](40.25,49.60,40.65,50.40)->.districts;
.districts out center tags;`;

async function overpass() {
  for (const url of ENDPOINTS) {
    try {
      console.log(`→ ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'panigo-prototype/1.0 (educational)' },
        body: 'data=' + encodeURIComponent(QUERY),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).elements;
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
/** Outer ring of a way, or the largest outer ring of a multipolygon relation. */
function ringOf(e) {
  if (e.type === 'way' && e.geometry?.length > 2) return e.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
  if (e.type === 'relation' && e.members) {
    const rings = e.members.filter((m) => m.role !== 'inner' && m.geometry?.length > 2).map((m) => m.geometry.map((g) => ({ lat: g.lat, lng: g.lon })));
    return rings.sort((a, b) => polyArea(b) - polyArea(a))[0] ?? null;
  }
  return null;
}
/** Polygon area in m² (shoelace on a local equirectangular projection). */
function polyArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const k = Math.cos(rad(ring[0].lat));
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += rad(ring[j].lng) * k * R * rad(ring[i].lat) * R - rad(ring[i].lng) * k * R * rad(ring[j].lat) * R;
  }
  return Math.abs(a / 2);
}
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) c = !c;
  }
  return c;
}
/** Representative point guaranteed inside the polygon (closest interior sample to the centroid). */
function interiorPoint(ring) {
  const cen = { lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length, lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length };
  if (inside(cen, ring)) return cen;
  const lats = ring.map((p) => p.lat), lngs = ring.map((p) => p.lng);
  const [a0, a1, b0, b1] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  let best = null, bd = Infinity;
  for (let i = 1; i < 30; i++)
    for (let j = 1; j < 30; j++) {
      const q = { lat: a0 + ((a1 - a0) * i) / 30, lng: b0 + ((b1 - b0) * j) / 30 };
      if (!inside(q, ring)) continue;
      const d = (q.lat - cen.lat) ** 2 + (q.lng - cen.lng) ** 2;
      if (d < bd) { bd = d; best = q; }
    }
  return best ?? ring[0];
}
const areaOf = (e) => polyArea(ringOf(e));
const pos = (e) => {
  if (e.type === 'node') return { lat: e.lat, lng: e.lon };
  const ring = ringOf(e);
  if (ring) return interiorPoint(ring);
  if (e.center) return { lat: e.center.lat, lng: e.center.lon };
  return null;
};
const round = (p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) });
const nameOf = (t) => t['name:az'] || t.name || t['name:en'];
const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * 0.76) * 111_000;

function dedupe(items, minM) {
  const out = [];
  for (const it of items) if (!out.some((o) => o.name === it.name || dist(o.location, it.location) < minM)) out.push(it);
  return out;
}

const CACHE = path.join(ROOT, 'scripts/.cache/osm-raw.json');
let els;
if (process.argv.includes('--cached') && fs.existsSync(CACHE)) els = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
else {
  els = await overpass();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(els));
}
console.log(`✓ ${els.length} OSM elements`);

const metro = dedupe(
  els
    .filter((e) => e.tags?.station === 'subway' || e.tags?.subway === 'yes')
    .map((e) => ({ name: nameOf(e.tags), location: pos(e), wheelchair: e.tags.wheelchair }))
    .filter((x) => x.name && x.location),
  150,
).map((m) => ({
  wheelchair: m.wheelchair,
  id: `m-${slug(m.name)}`,
  name: `${m.name.replace(/\s*\(.*\)/, '')} m/st sığınacağı`,
  type: 'shelter',
  location: round(m.location),
  capacity: 1500,
  source: 'osm:station=subway',
}));

/** Not suitable as public assembly areas: restricted/government sites, memorials, zoo. */
const EXCLUDE = /residence|iqamətgah|prezident|president|xiyaban|zoopark|zoo|məzarlıq|cemetery/i;

/** Wikidata enrichment: P1082 population, P1083 venue capacity. */
async function wikidata(ids) {
  const out = {};
  const list = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < list.length; i += 40) {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids=${list.slice(i, i + 40).join('|')}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'panigo-prototype/1.0 (educational)' }, signal: AbortSignal.timeout(60_000) });
      const j = await r.json();
      for (const [id, ent] of Object.entries(j.entities ?? {})) {
        const latest = (p) => {
          const cl = ent.claims?.[p] ?? [];
          const vals = cl.map((c) => ({ v: +c.mainsnak?.datavalue?.value?.amount, t: c.qualifiers?.P585?.[0]?.datavalue?.value?.time ?? '' })).filter((x) => Number.isFinite(x.v));
          vals.sort((a, b) => b.t.localeCompare(a.t));
          return vals[0] ? { value: vals[0].v, year: vals[0].t.slice(1, 5) || undefined } : undefined;
        };
        out[id] = { population: latest('P1082'), capacity: latest('P1083') };
      }
    } catch (e) {
      console.warn('  wikidata failed:', e.message);
    }
  }
  return out;
}
const wdIds = els.filter((e) => (e.tags?.leisure === 'stadium' || e.tags?.boundary === 'administrative') && e.tags?.wikidata).map((e) => e.tags.wikidata);
const WD = await wikidata(wdIds);
console.log(`✓ wikidata: ${Object.keys(WD).length} entities`);

const parksAll = dedupe(
  els
    .filter((e) => e.tags?.leisure === 'park' && pos(e) && !EXCLUDE.test(nameOf(e.tags) ?? ''))
    .map((e) => ({ name: nameOf(e.tags), location: pos(e), area: areaOf(e), wheelchair: e.tags.wheelchair }))
    .filter((p) => p.name && p.area >= 25_000)
    .sort((a, b) => b.area - a.area),
  300,
).map((p) => ({
  id: `k-${slug(p.name)}`,
  name: p.name,
  wheelchair: p.wheelchair,
  type: 'park',
  location: round(p.location),
  capacity: Math.max(500, Math.min(20_000, Math.round((p.area * 0.5) / 2 / 100) * 100)),
  areaM2: Math.round(p.area),
  source: 'osm:leisure=park',
}));

const stadiums = dedupe(
  els
    .filter((e) => e.tags?.leisure === 'stadium' && pos(e))
    .map((e) => {
      const osmCap = parseInt(e.tags.capacity, 10);
      const wdCap = WD[e.tags.wikidata]?.capacity?.value;
      return { wheelchair: e.tags.wheelchair, name: nameOf(e.tags), location: pos(e), cap: Number.isFinite(osmCap) ? osmCap : wdCap, capSrc: Number.isFinite(osmCap) ? 'osm:capacity' : wdCap ? `wikidata:${e.tags.wikidata}#P1083` : 'default' };
    }),
  250,
)
  .filter((s) => s.name && !EXCLUDE.test(s.name))
  .map((s) => ({
    id: `s-${slug(s.name)}`,
    name: s.name,
    wheelchair: s.wheelchair,
    type: 'stadium',
    location: round(s.location),
    seats: s.cap,
    // evacuation capacity = seats (pitch reserved for services), capped for crowd-safety
    capacity: s.cap > 0 ? Math.min(Math.round(s.cap), 30_000) : 3000,
    source: `osm:leisure=stadium; capacity=${s.capSrc}`,
  }));

// Open now: all metro shelters, 22 biggest parks, stadiums ≥ 10k; the rest → reserve pool
const points = [
  ...metro.map((p) => ({ ...p, status: 'open' })),
  ...parksAll.slice(0, 22).map((p) => ({ ...p, status: 'open' })),
  ...parksAll.slice(22, 30).map((p) => ({ ...p, status: 'reserve' })),
  ...stadiums.map((s) => ({ ...s, status: s.capacity >= 10_000 ? 'open' : 'reserve' })),
];

/**
 * Step-free accessibility (wheelchair / stretcher):
 *  - explicit OSM wheelchair=yes|limited → accessible, wheelchair=no → not
 *  - otherwise: parks & stadiums (ground-level open areas) → accessible;
 *    deep metro stations (escalators/stairs, no lift data) → not accessible
 */
for (const p of points) {
  const w = p.wheelchair;
  p.accessible = w ? w === 'yes' || w === 'limited' : p.type !== 'shelter';
  p.accessSource = w ? `osm:wheelchair=${w}` : p.type === 'shelter' ? 'rule:deep-metro-stairs' : 'rule:ground-level-open-area';
  delete p.wheelchair;
}

/** Pedestrian barriers for wheelchairs: real steps and stair-access underpasses (midpoints). */
const barriers = els
  .filter((e) => e.type === 'way' && (e.tags?.highway === 'steps' || (e.tags?.highway === 'footway' && (e.tags.tunnel === 'yes' || e.tags.layer === '-1'))) && e.geometry?.length)
  .map((e) => {
    const g = e.geometry[Math.floor(e.geometry.length / 2)];
    return { lat: +g.lat.toFixed(5), lng: +g.lon.toFixed(5), kind: e.tags.highway === 'steps' ? 'steps' : 'underpass' };
  });

const fire = dedupe(
  els.filter((e) => e.tags?.amenity === 'fire_station' && pos(e)).map((e, i) => ({ name: nameOf(e.tags) || `FHN yanğınsöndürmə hissəsi #${i + 1}`, location: pos(e) })),
  300,
);
const hospitals = dedupe(
  els.filter((e) => e.tags?.amenity === 'hospital' && pos(e)).map((e) => ({ name: nameOf(e.tags), location: pos(e) })).filter((h) => h.name),
  400,
);

const brigades = [
  ...fire.slice(0, 10).map((f, i) => ({ id: `b-fire-${i + 1}`, name: `Yanğın-${i + 1} · ${short(f.name)}`, type: 'fire', location: round(f.location), source: 'osm:amenity=fire_station' })),
  ...fire.slice(0, 6).map((f, i) => ({ id: `b-res-${i + 1}`, name: `Xilasetmə-${i + 1} · ${short(f.name)}`, type: 'rescue', location: round({ lat: f.location.lat + 0.0006, lng: f.location.lng + 0.0006 }), source: 'osm:amenity=fire_station' })),
  ...hospitals.slice(0, 10).map((h, i) => ({ id: `b-med-${i + 1}`, name: `Təcili Tibbi-${i + 1} · ${short(h.name)}`, type: 'medical', location: round(h.location), source: 'osm:amenity=hospital' })),
];
function short(s) {
  return s.length > 28 ? s.slice(0, 27) + '…' : s;
}

const districts = els
  .filter((e) => e.type === 'relation' && e.tags?.boundary === 'administrative' && pos(e))
  .map((e) => {
    const wd = WD[e.tags.wikidata]?.population;
    return {
      name: nameOf(e.tags),
      center: round(pos(e)),
      population: parseInt(e.tags.population, 10) || wd?.value,
      populationYear: wd?.year,
      populationSource: e.tags.population ? 'osm' : wd ? `wikidata:${e.tags.wikidata}#P1082` : undefined,
      adminLevel: e.tags.admin_level,
      wikidata: e.tags.wikidata,
    };
  })
  .filter((d) => /rayonu|district/i.test(d.name ?? '') && !/abşeron/i.test(d.name));

const out = {
  source: 'OpenStreetMap contributors (ODbL) via Overpass API',
  fetchedAt: new Date().toISOString(),
  bbox: BBOX,
  counts: { barriers: 0, metro: metro.length, parks: parksAll.length, stadiums: stadiums.length, fireStations: fire.length, hospitals: hospitals.length, districts: districts.length },
  points,
  brigades,
  districts,
  barriers,
  hospitals: hospitals.map((h) => ({ name: h.name, location: round(h.location) })),
};
out.counts.barriers = barriers.length;
out.counts.accessiblePoints = points.filter((p) => p.accessible).length;
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('✓ wrote', path.relative(ROOT, OUT), out.counts);
