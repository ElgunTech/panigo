import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import type { LatLng, RouteProfile } from '@shared/types';
import { haversine } from '../domain/geo';
import type { RawRoute } from './types';

export interface ArchivedRoute extends RawRoute {
  profile: RouteProfile;
  from: LatLng;
  to: LatLng;
  at: number;
}

/** Destinations are fixed points (assembly points / metro exits): match within this radius. */
const DEST_MATCH_M = 40;
/** A cached route can serve a citizen whose position is within this distance of its start. */
const ORIGIN_MATCH_M = 450;
const MAX_ROUTES = 20_000;

/**
 * Local backup of real routes (Challenge Drop 2 — "son keşlənmiş marşrutlar").
 * Every route successfully returned by the EXTERNAL API is archived — in memory
 * and, when a DB file is configured, in SQLite so it survives restarts. A seed
 * (offline-routing.json) guarantees routes exist even on a fresh start.
 */
export class RouteArchive {
  private routes: ArchivedRoute[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;

  constructor(dbFile: string | null = null, seed: ArchivedRoute[] = []) {
    this.routes.push(...seed);
    if (!dbFile) return;
    try {
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
      this.db = new DatabaseSync(dbFile);
      this.db.exec(`CREATE TABLE IF NOT EXISTS route_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT, profile TEXT NOT NULL,
        from_lat REAL, from_lng REAL, to_lat REAL, to_lng REAL,
        distance_m REAL, duration_s REAL, geometry TEXT NOT NULL, at INTEGER NOT NULL)`);
      for (const r of this.db.prepare('SELECT * FROM route_cache ORDER BY id DESC LIMIT ?').all(MAX_ROUTES) as Record<string, number | string>[]) {
        this.routes.push({
          profile: r.profile as RouteProfile,
          from: { lat: Number(r.from_lat), lng: Number(r.from_lng) },
          to: { lat: Number(r.to_lat), lng: Number(r.to_lng) },
          distanceM: Number(r.distance_m),
          durationS: Number(r.duration_s),
          geometry: JSON.parse(String(r.geometry)),
          at: Number(r.at),
        });
      }
    } catch (err) {
      console.warn('[route-archive] persistence disabled:', (err as Error).message);
      this.db = null;
    }
  }

  get size() {
    return this.routes.length;
  }

  save(profile: RouteProfile, from: LatLng, to: LatLng, r: RawRoute) {
    if (profile === 'vehicle' || r.geometry.length < 2) return;
    // de-duplicate: same destination + practically the same origin
    if (this.routes.some((x) => x.profile === profile && haversine(x.to, to) < 5 && haversine(x.from, from) < 25)) return;
    const entry: ArchivedRoute = { profile, from, to, distanceM: r.distanceM, durationS: r.durationS, geometry: r.geometry, at: Date.now() };
    this.routes.push(entry);
    if (this.routes.length > MAX_ROUTES) this.routes.splice(0, this.routes.length - MAX_ROUTES);
    try {
      this.db
        ?.prepare('INSERT INTO route_cache (profile, from_lat, from_lng, to_lat, to_lng, distance_m, duration_s, geometry, at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(profile, from.lat, from.lng, to.lat, to.lng, r.distanceM, r.durationS, JSON.stringify(r.geometry), entry.at);
    } catch {
      /* best effort — the in-memory copy still serves */
    }
  }

  /**
   * Best cached route towards `to` starting near `from`. The citizen's position is
   * stitched to the cached start, so the returned geometry starts where they are.
   */
  find(profile: RouteProfile, from: LatLng, to: LatLng): RawRoute | null {
    const wanted = profile === 'vehicle' ? [] : profile === 'accessible' ? ['accessible', 'standard'] : ['standard', 'accessible'];
    let best: ArchivedRoute | null = null;
    let bestD = Infinity;
    for (const r of this.routes) {
      if (!wanted.includes(r.profile) || haversine(r.to, to) > DEST_MATCH_M) continue;
      const d = haversine(r.from, from);
      if (d <= ORIGIN_MATCH_M && d < bestD) {
        best = r;
        bestD = d;
      }
    }
    if (!best) return null;
    return {
      geometry: bestD > 5 ? [from, ...best.geometry] : best.geometry,
      distanceM: best.distanceM + bestD,
      durationS: best.durationS + bestD / 1.3,
    };
  }

  close() {
    this.db?.close();
  }
}

/** Static coordinate matrix (anchors × targets) + seed routes from offline-routing.json. */
export interface OfflineRoutingData {
  source: string;
  generatedAt: string;
  anchors: LatLng[];
  targets: LatLng[];
  distances: (number | null)[][];
  durations: (number | null)[][];
  routes: { profile: RouteProfile; from: LatLng; to: LatLng; distanceM: number; durationS: number; geometry: LatLng[] }[];
}

export function loadOfflineRouting(): OfflineRoutingData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../data/offline-routing.json'), 'utf8')) as OfflineRoutingData;
  } catch {
    return null;
  }
}
