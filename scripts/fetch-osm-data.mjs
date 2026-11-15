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

const QUERY = `[out:json][timeout:90];
(
  node["station"="subway"](${BBOX});
  node["railway"="station"]["subway"="yes"](${BBOX});
  way["leisure"="park"]["name"](${BBOX});
  relation["leisure"="park"]["name"](${BBOX});
  way["leisure"="stadium"]["name"](${BBOX});
  relation["leisure"="stadium"]["name"](${BBOX});
  nwr["amenity"="fire_station"](${BBOX});
  nwr["amenity"="hospital"]["name"](${BBOX});
  relation["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]["name"](40.25,49.60,40.65,50.40);
);
out center bb tags;`;

async function overpass() {
  for (const url of ENDPOINTS) {
    try {
      console.log(`→ ${url}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'uce-prototype/1.0 (educational)' },
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
function bboxAreaM2(b) {
  if (!b) return 0;
  const h = rad(b.maxlat - b.minlat) * R;
  const w = rad(b.maxlon - b.minlon) * R * Math.cos(rad((b.maxlat + b.minlat) / 2));
  return h * w * 0.65; // bbox → polygon fill factor
}
const pos = (e) =>
  e.type === 'node'
    ? { lat: e.lat, lng: e.lon }
    : e.center
      ? { lat: e.center.lat, lng: e.center.lon }
      : e.bounds
        ? { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lng: (e.bounds.minlon + e.bounds.maxlon) / 2 }
        : null;
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
    .map((e) => ({ name: nameOf(e.tags), location: pos(e) }))
    .filter((x) => x.name && x.location),
  150,
).map((m) => ({
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
      const r = await fetch(url, { headers: { 'User-Agent': 'uce-prototype/1.0 (educational)' }, signal: AbortSignal.timeout(60_000) });
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
    .map((e) => ({ name: nameOf(e.tags), location: pos(e), area: bboxAreaM2(e.bounds) }))
    .filter((p) => p.name && p.area >= 25_000)
    .sort((a, b) => b.area - a.area),
  300,
).map((p) => ({
  id: `k-${slug(p.name)}`,
  name: p.name,
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
      return { name: nameOf(e.tags), location: pos(e), cap: Number.isFinite(osmCap) ? osmCap : wdCap, capSrc: Number.isFinite(osmCap) ? 'osm:capacity' : wdCap ? `wikidata:${e.tags.wikidata}#P1083` : 'default' };
    }),
  250,
)
  .filter((s) => s.name && !EXCLUDE.test(s.name))
  .map((s) => ({
    id: `s-${slug(s.name)}`,
    name: s.name,
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
  counts: { metro: metro.length, parks: parksAll.length, stadiums: stadiums.length, fireStations: fire.length, hospitals: hospitals.length, districts: districts.length },
  points,
  brigades,
  districts,
  hospitals: hospitals.map((h) => ({ name: h.name, location: round(h.location) })),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log('✓ wrote', path.relative(ROOT, OUT), out.counts);
