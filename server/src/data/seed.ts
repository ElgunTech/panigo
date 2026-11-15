import fs from 'node:fs';
import path from 'node:path';
import type { AssemblyPoint, AssemblyPointType, Barrier, Brigade, BrigadeType, LatLng, Zone } from '@shared/types';
import { ODAZ, stationKey, venueCapacity } from './opendata';

/**
 * Real-world dataset imported from OpenStreetMap + Wikidata by
 * scripts/fetch-osm-data.mjs (see docs/DATA.md). If the file is missing or
 * DATASET=curated, the hand-curated fallback below is used — the system never
 * depends on the network at start-up.
 */
interface OsmDataset {
  source: string;
  fetchedAt: string;
  points: { id: string; name: string; type: AssemblyPointType; location: LatLng; capacity: number; status: 'open' | 'reserve'; source: string; accessible?: boolean }[];
  barriers?: Barrier[];
  brigades: { id: string; name: string; type: BrigadeType; location: LatLng; source: string }[];
  districts: { name: string; population?: number; populationYear?: string; populationSource?: string }[];
  hospitals: { name: string; location: LatLng }[];
}

function loadDataset(): OsmDataset | null {
  if (process.env.DATASET === 'curated') return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'baku-osm.json'), 'utf8')) as OsmDataset;
  } catch {
    return null;
  }
}
export const DATASET = loadDataset();

/** Wheelchair barriers (real OSM steps + stair underpasses). */
export const BARRIERS: Barrier[] = DATASET?.barriers ?? [];

/** Real hospitals (OSM) — medical units transport patients to the nearest one. */
export const HOSPITALS: { name: string; location: LatLng }[] = DATASET?.hospitals ?? [];

/** Bakı şəhəri — rayon zonaları (təxmini mərkəzlər). */
export const ZONES: Zone[] = [
  { id: 'sabail', name: 'Səbail', center: { lat: 40.3655, lng: 49.8352 }, radiusM: 2200 },
  { id: 'nasimi', name: 'Nəsimi', center: { lat: 40.3875, lng: 49.8395 }, radiusM: 1800 },
  { id: 'yasamal', name: 'Yasamal', center: { lat: 40.3925, lng: 49.8135 }, radiusM: 2000 },
  { id: 'narimanov', name: 'Nərimanov', center: { lat: 40.4075, lng: 49.8705 }, radiusM: 2200 },
  { id: 'xatai', name: 'Xətai', center: { lat: 40.3835, lng: 49.9045 }, radiusM: 2500 },
  { id: 'nizami', name: 'Nizami', center: { lat: 40.4035, lng: 49.9365 }, radiusM: 2200 },
  { id: 'binagadi', name: 'Binəqədi', center: { lat: 40.4300, lng: 49.8300 }, radiusM: 2500 },
  { id: 'sabunchu', name: 'Sabunçu', center: { lat: 40.4280, lng: 49.9300 }, radiusM: 2500 },
].map((z): Zone => {
  // Prefer official DSK 2024 figures (opendata.az); fall back to Wikidata (OSM import)
  const off = ODAZ?.districts[z.name];
  if (off) {
    return { ...z, population: off.population, populationYear: String(off.year), densityPerKm2: off.densityPerKm2, disabledPersons: off.disabledPersons };
  }
  const d = DATASET?.districts.find((x) => x.name.startsWith(z.name));
  return d?.population ? { ...z, population: d.population, populationYear: d.populationYear } : z;
});

type PointSeed = [id: string, name: string, type: AssemblyPointType, lat: number, lng: number, capacity: number, occPct: number, reserve?: boolean];

const POINT_SEEDS: PointSeed[] = [
  ['p-boulevard', 'Dənizkənarı Milli Park', 'park', 40.3712, 49.8505, 6000, 62],
  ['p-tofiq', 'Tofiq Bəhramov Stadionu', 'stadium', 40.3998, 49.8628, 12000, 41],
  ['p-olympic', 'Bakı Olimpiya Stadionu', 'stadium', 40.4302, 49.9197, 20000, 23],
  ['p-ataturk', 'Atatürk parkı', 'park', 40.4048, 49.8735, 3000, 55],
  ['p-hac', 'Heydər Əliyev Mərkəzi parkı', 'park', 40.3955, 49.8690, 4000, 86],
  ['p-dagustu', 'Dağüstü park', 'park', 40.3612, 49.8305, 4000, 48],
  ['p-28may', '28 May m/st sığınacağı', 'shelter', 40.3797, 49.8486, 1500, 71],
  ['p-ganjlik', 'Gənclik m/st sığınacağı', 'shelter', 40.4004, 49.8513, 1500, 35],
  ['p-elmler', 'Elmlər Akademiyası sığınacağı', 'shelter', 40.3750, 49.8150, 1200, 58],
  ['p-koroglu', 'Koroğlu m/st sığınacağı', 'shelter', 40.4210, 49.9180, 1500, 30],
  ['p-dostluq', 'Xalqlar Dostluğu sığınacağı', 'shelter', 40.3973, 49.9526, 1200, 44],
  ['p-botanika', 'Mərkəzi Botanika bağı', 'park', 40.3895, 49.8035, 3500, 27],
  ['p-xatai', 'Xətai rayon parkı', 'park', 40.3840, 49.8960, 3000, 52],
  ['p-binagadi', 'Binəqədi mərkəzi parkı', 'park', 40.4290, 49.8350, 3000, 39],
  // Ehtiyat (reserve) məntəqələr — dispetçer qərarı ilə açılır
  ['r-gymnastics', 'Milli Gimnastika Arenası (ehtiyat)', 'stadium', 40.4170, 49.9070, 5000, 0, true],
  ['r-sport-palace', 'Bakı İdman Sarayı (ehtiyat)', 'stadium', 40.3790, 49.8620, 4000, 0, true],
  ['r-yasamal', 'Yasamal təhsil kompleksi (ehtiyat)', 'shelter', 40.3955, 49.8215, 2000, 0, true],
  ['r-binagadi', 'Binəqədi idman kompleksi (ehtiyat)', 'stadium', 40.4345, 49.8180, 3000, 0, true],
  ['r-xatai', 'Xətai Arena (ehtiyat)', 'stadium', 40.3880, 49.9180, 3000, 0, true],
  ['r-nasimi', 'Nəsimi məktəb sığınacağı (ehtiyat)', 'shelter', 40.3900, 49.8420, 1500, 0, true],
];

type BrigadeSeed = [id: string, name: string, type: BrigadeType, lat: number, lng: number];

const BRIGADE_SEEDS: BrigadeSeed[] = [
  ['b-fire-1', 'FHN Yanğın-1', 'fire', 40.3880, 49.8450],
  ['b-fire-2', 'FHN Yanğın-2', 'fire', 40.4100, 49.9000],
  ['b-fire-3', 'FHN Yanğın-3', 'fire', 40.3700, 49.8250],
  ['b-med-1', 'Təcili Tibbi-1', 'medical', 40.3950, 49.8550],
  ['b-med-2', 'Təcili Tibbi-2', 'medical', 40.3820, 49.9200],
  ['b-med-3', 'Təcili Tibbi-3', 'medical', 40.4200, 49.8350],
  ['b-res-1', 'Xilasetmə-1', 'rescue', 40.4000, 49.8300],
  ['b-res-2', 'Xilasetmə-2', 'rescue', 40.3780, 49.8750],
  ['b-res-3', 'Xilasetmə-3', 'rescue', 40.4250, 49.9350],
];

/** Demo üçün hazır yol bağlanması ssenariləri. */
export const CLOSURE_PRESETS: { name: string; location: LatLng; radiusM: number }[] = [
  { name: 'Neftçilər prospekti', location: { lat: 40.3722, lng: 49.8420 }, radiusM: 260 },
  { name: 'Heydər Əliyev prospekti', location: { lat: 40.4060, lng: 49.8920 }, radiusM: 300 },
  { name: 'Azadlıq prospekti', location: { lat: 40.3990, lng: 49.8440 }, radiusM: 250 },
  { name: 'Tbilisi prospekti', location: { lat: 40.3950, lng: 49.8230 }, radiusM: 250 },
  { name: 'Babək prospekti', location: { lat: 40.3890, lng: 49.8880 }, radiusM: 280 },
];

/** Deterministic pseudo-random initial load (20–75%) so every demo run starts identically. */
function initialLoadPct(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 20 + (Math.abs(h) % 56);
}

/** Demo hot-spots: realistic pressure on well-known central points at t=0. */
const INITIAL_HOTSPOTS: Record<string, number> = { 'Dənizkənarı Milli Park': 86 };

type SeedPoint = OsmDataset['points'][number] & { entrances?: AssemblyPoint['entrances']; ridershipDaily?: number; initialPct?: number };

/**
 * Official metro shelters (opendata.az, Bakı Metropoliteni): only the 27 operating
 * stations, each with its real exits as entrances. Initial load ∝ average daily
 * ridership 2025 (busiest station ≈ 80 %). OSM only contributes the wheelchair tag.
 */
function officialMetroShelters(): SeedPoint[] {
  if (!ODAZ) return [];
  const maxRide = Math.max(...Object.values(ODAZ.metroRidership).map((r) => r.avgDaily));
  const osmByKey = new Map((DATASET?.points ?? []).filter((p) => p.type === 'shelter').map((p) => [stationKey(p.name), p]));
  return Object.entries(ODAZ.metroExits).map(([key, st]) => {
    const exits = st.exits;
    const centre = { lat: exits.reduce((s, e) => s + e.lat, 0) / exits.length, lng: exits.reduce((s, e) => s + e.lng, 0) / exits.length };
    const osm = osmByKey.get(key);
    const ride = ODAZ!.metroRidership[key]?.avgDaily;
    return {
      id: `m-${key}`,
      name: `${st.name} m/st sığınacağı`,
      type: 'shelter' as const,
      location: osm?.location ?? { lat: +centre.lat.toFixed(6), lng: +centre.lng.toFixed(6) },
      capacity: 1500,
      status: 'open' as const,
      source: 'opendata.az:metro-cixislari-uzre-koordinatlar',
      accessible: osm?.accessible ?? false,
      entrances: exits.map((e) => ({ lat: e.lat, lng: e.lng, label: e.label })),
      ridershipDaily: ride,
      initialPct: ride ? Math.round(20 + (60 * ride) / maxRide) : undefined,
    };
  });
}

/** Official sport venues (Gənclər və İdman Nazirliyi) not already present → reserve pool. */
function officialVenues(existing: SeedPoint[]): SeedPoint[] {
  if (!ODAZ) return [];
  const near = (a: LatLng, b: LatLng) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * 0.76) * 111_000 < 300;
  return ODAZ.venues
    .filter((v) => !existing.some((p) => near(p.location, v.location)))
    .map((v) => ({
      id: `v-${stationKey(v.name).slice(0, 32)}`,
      name: v.name.replace(/[“”"]/g, '').replace(/\s+MMC?$/, ''),
      type: 'stadium' as const,
      location: v.location,
      capacity: venueCapacity(v.name),
      status: 'reserve' as const,
      source: `opendata.az:${v.source}`,
      accessible: true,
    }));
}

function seedSource(): SeedPoint[] {
  if (!DATASET) return [];
  const metro = officialMetroShelters();
  const base: SeedPoint[] = metro.length ? [...DATASET.points.filter((p) => p.type !== 'shelter'), ...metro] : DATASET.points;
  return [...base, ...officialVenues(base)];
}

export function seedPoints(now = Date.now()): AssemblyPoint[] {
  if (DATASET) {
    return seedSource().map((p) => {
      const occPct = p.status === 'reserve' ? 0 : (INITIAL_HOTSPOTS[p.name] ?? p.initialPct ?? initialLoadPct(p.id));
      return {
        id: p.id,
        name: p.name,
        type: p.type,
        location: p.location,
        zoneId: zoneOf(p.location).id,
        capacity: p.capacity,
        accessible: p.accessible ?? p.type !== 'shelter',
        entrances: p.entrances,
        ridershipDaily: p.ridershipDaily,
        source: p.source,
        occupancy: Math.round((p.capacity * occPct) / 100),
        incoming: 0,
        status: p.status,
        updatedAt: now,
      };
    });
  }
  return POINT_SEEDS.map(([id, name, type, lat, lng, capacity, occPct, reserve]) => ({
    id,
    name,
    type,
    location: { lat, lng },
    zoneId: zoneOf({ lat, lng }).id,
    capacity,
    accessible: type !== 'shelter',
    occupancy: Math.round((capacity * occPct) / 100),
    incoming: 0,
    status: reserve ? 'reserve' : 'open',
    updatedAt: now,
  }));
}

export function seedBrigades(now = Date.now()): Brigade[] {
  if (DATASET) {
    return DATASET.brigades.map((b) => ({
      id: b.id,
      name: b.name,
      type: b.type,
      location: b.location,
      base: b.location,
      status: 'available',
      targetSosIds: [],
      updatedAt: now,
    }));
  }
  return BRIGADE_SEEDS.map(([id, name, type, lat, lng]) => ({
    id,
    name,
    type,
    location: { lat, lng },
    base: { lat, lng },
    status: 'available',
    targetSosIds: [],
    updatedAt: now,
  }));
}

/** Nearest zone by distance to centre (zones are Voronoi-like cells). */
export function zoneOf(p: LatLng): Zone {
  let best = ZONES[0];
  let bestD = Infinity;
  for (const z of ZONES) {
    const d = (z.center.lat - p.lat) ** 2 + ((z.center.lng - p.lng) * 0.76) ** 2;
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

/** Bounding box of the operational area (used for validation). */
export const CITY_BOUNDS = { minLat: 40.30, maxLat: 40.50, minLng: 49.70, maxLng: 50.10 };
