#!/usr/bin/env node
/**
 * Official open data import from opendata.az (Azərbaycan Respublikası Açıq Məlumatlar Portalı).
 *
 *   node scripts/fetch-opendata-az.mjs
 *
 * The portal is CKAN-based (API: https://admin.opendata.az/api/3/action). Each dataset is
 * resolved by its slug → latest resource URL, so the import keeps working when the
 * publisher uploads a new file. Output: server/src/data/opendata-az.json (committed,
 * so the system runs offline). See docs/DATA.md for the analysis of all 2 071 datasets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'server/src/data/opendata-az.json');
const API = 'https://admin.opendata.az/api/3/action';
const UA = { 'User-Agent': 'panigo-prototype/1.0 (educational)' };
// Baku operational area (excludes Sumqayıt at ~40.59 N)
const BAKU = { minLat: 40.3, maxLat: 40.5, minLng: 49.7, maxLng: 50.1 };
const inBaku = (p) => p.lat >= BAKU.minLat && p.lat <= BAKU.maxLat && p.lng >= BAKU.minLng && p.lng <= BAKU.maxLng;

const sources = [];
async function dataset(slug, attempt = 1) {
  try {
    const r = await (await fetch(`${API}/package_show?id=${slug}`, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
    if (!r.success) throw new Error(`package_show ${slug}`);
    return r.result;
  } catch (e) {
    // The portal occasionally answers with an HTML error page (rate limit / maintenance) — back off and retry
    if (attempt >= 4) throw e;
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return dataset(slug, attempt + 1);
  }
}
async function resource(slug, pick = () => true) {
  const d = await dataset(slug);
  const res = d.resources.find(pick) ?? d.resources[0];
  const body = await (await fetch(res.url, { headers: UA, signal: AbortSignal.timeout(60000) })).text();
  sources.push({ dataset: d.title, slug, organization: d.organization?.title, license: d.license_id, modified: d.metadata_modified?.slice(0, 10), url: `https://opendata.az/@${d.organization?.name}/${slug}`, resource: res.url });
  console.log(`✓ ${d.title} — ${d.organization?.title}`);
  return body.replace(/^﻿/, '');
}

/** Minimal CSV parser (quotes, ; or , delimiter). */
function csv(text, delim) {
  const d = delim ?? (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === d) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const clean = (s) => String(s ?? '').replace(/\[cite:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));
/** Station name normalisation so "28-May", "28 May", "28 May 2-ci çıxış" match. */
export function stationKey(s) {
  let k = clean(s)
    .toLowerCase()
    .replace(/m\/st.*$|stansiyası|sığınacağı|\d+-ci çıxış.*$|çıxış.*$/g, '')
    .replace(/ə/g, 'e').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ç/g, 'c').replace(/ş/g, 's')
    .replace(/[^a-z0-9]+/g, '');
  if (/^2805/.test(k)) k = '28may'; // Excel turned "28 May" into a date
  if (k.endsWith('xetai')) k = 'xetai'; // "Şah İsmayıl Xətai" ↔ "Xətai"
  if (k.startsWith('nerimannerimanov')) k = 'nerimanov';
  return k;
}

// 1) Metro exits (Bakı Metropoliteni) — shelter entrances
const exitsRows = csv(await resource('metro-cixislari-uzre-koordinatlar'));
const metroExits = {};
for (const r of exitsRows.slice(1)) {
  const lat = num(r[2]) / (num(r[2]) > 1000 ? 1e6 : 1);
  const lng = num(r[3]) / (num(r[3]) > 1000 ? 1e6 : 1);
  if (!Number.isFinite(lat) || !inBaku({ lat, lng })) continue;
  const key = stationKey(r[0]);
  // Excel converted "28 May" into a date in the source file — restore the station name
  const fixName = (s) => (key === '28may' ? '28 May' : clean(s));
  (metroExits[key] ??= { name: fixName(r[0]), nameEn: key === '28may' ? '28 May' : clean(r[1]), exits: [] }).exits.push({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), label: clean(r[5]), address: clean(r[4]) });
}

// 2) Metro ridership 2025 — average daily entries per station
const ridRows = csv(await resource('stansiyalar-uzre-gundelik-sernisin-gedislerinin-sayi', (r) => /2025/.test(r.url)));
const acc = {};
for (const r of ridRows.slice(1)) {
  const k = stationKey(r[1]);
  const v = num(r[2]);
  if (!k || !Number.isFinite(v)) continue;
  (acc[k] ??= { name: clean(r[1]), sum: 0, n: 0 });
  acc[k].sum += v;
  acc[k].n++;
}
const metroRidership = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { name: v.name, avgDaily: Math.round(v.sum / v.n), days: v.n }]));

// 3) Official sport venues (Gənclər və İdman Nazirliyi)
const venues = [];
for (const slug of ['idman-qurgulari-ve-stadionlar', 'olimpiya-idman-kompleksleri']) {
  const gj = JSON.parse(await resource(slug));
  for (const f of gj.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lat) || !inBaku({ lat, lng })) continue;
    venues.push({ name: clean(f.properties?.name), address: clean(f.properties?.address), location: { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }, source: slug });
  }
}

// 4) District area / population / density 2024 (DSK)
const popRows = csv(await resource('2024-ci-ilin-evveline-olkenin-iqtisadi-ve-inzibati-rayonlarinin-erazisi-ehalisinin-sayi-ve-sixligi'), ';');
const districts = {};
for (const r of popRows) {
  const name = clean(r[0]);
  if (!/rayonu$/.test(name)) continue;
  const population = Math.round(num(r[2]) * 1000);
  if (!Number.isFinite(population)) continue;
  districts[name.replace(/ rayonu$/, '')] = { population, areaKm2: num(r[1]) * 1000, densityPerKm2: num(r[3]), year: 2024 };
}
const bakuDistricts = ['Binəqədi', 'Xətai', 'Xəzər', 'Qaradağ', 'Nərimanov', 'Nəsimi', 'Nizami', 'Pirallahı', 'Sabunçu', 'Səbail', 'Suraxanı', 'Yasamal'];
for (const k of Object.keys(districts)) if (!bakuDistricts.includes(k)) delete districts[k];

// 5) Persons with disabilities by district (DSK, latest year)
const disRows = csv(await resource('i-lin-evveline-olkenin-iqtisadi-rayonlari-ve-inzibati-erazi-vahidleri-uzre-elilliyi-olan-sexsler', (r) => /csv/i.test(r.format)), ',');
const latest = Math.max(...disRows.slice(1).map((r) => num(r[0])).filter(Number.isFinite));
for (const r of disRows.slice(1)) {
  if (num(r[0]) !== latest || clean(r[3]) !== 'Cəmi') continue;
  const name = clean(r[2]).replace(/ rayonu$/, '');
  if (districts[name]) {
    districts[name].disabledPersons = num(r[5]);
    districts[name].disabledYear = latest;
  }
}

// 6) FHN: building / structure collapse incidents (national, yearly)
const colRows = csv(await resource('binalarin-qurgularin-ve-suxurlarin-zedelenmesi-dagilmasi-ve-qefleten-ucmasi'), ';');
const collapseStats = colRows
  .filter((r) => /^\d{4}$/.test(clean(r[0])))
  .map((r) => ({ year: +clean(r[0]), incidents: num(r[1]), deaths: num(r[5]), injured: num(r[9]), rescued: num(r[13]) }))
  .sort((a, b) => a.year - b.year);

const out = {
  source: 'opendata.az — Azərbaycan Respublikası Açıq Məlumatlar Portalı',
  fetchedAt: new Date().toISOString(),
  sources,
  counts: { metroStationsWithExits: Object.keys(metroExits).length, metroExits: Object.values(metroExits).reduce((s, m) => s + m.exits.length, 0), ridershipStations: Object.keys(metroRidership).length, venues: venues.length, districts: Object.keys(districts).length, collapseYears: collapseStats.length },
  metroExits,
  metroRidership,
  venues,
  districts,
  collapseStats,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log('✓ wrote', path.relative(ROOT, OUT), out.counts);
