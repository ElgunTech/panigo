import type { LatLng, RoadClosure, RouteProfile } from '@shared/types';
import { haversine } from '../domain/geo';
import type { OfflineRoutingData, RouteArchive } from './routeArchive';
import type { RawRoute, RoutingProvider } from './types';

/**
 * Local backup #1 — last cached REAL routes (SQLite archive + seed).
 * Geometry follows real streets; the RoutingService still rejects any cached
 * route that crosses a road closed after it was cached (closureAware = false).
 */
export class CachedRouteProvider implements RoutingProvider {
  readonly id = 'cache' as const;
  readonly closureAware = false;
  readonly mode = 'foot' as const;
  readonly supports: RouteProfile[] = ['standard', 'accessible'];

  constructor(private readonly archive: RouteArchive) {}

  async route(from: LatLng, to: LatLng, _closures: RoadClosure[], profile: RouteProfile = 'standard'): Promise<RawRoute[]> {
    const r = this.archive.find(profile, from, to);
    return r ? [r] : [];
  }
}

/** Max distance from the citizen to the nearest matrix anchor for the estimate to be meaningful. */
const ANCHOR_MAX_M = 1500;
const TARGET_MATCH_M = 60;

/**
 * Local backup #3 — static coordinate matrix (anchors × assembly points / metro exits)
 * with real pedestrian distances & times pre-computed from OSRM. Gives an accurate
 * distance / ETA even with no live routing; geometry is an approximate leg via the anchor.
 */
export class MatrixProvider implements RoutingProvider {
  readonly id = 'matrix' as const;
  readonly closureAware = true; // estimate only — never blocks guidance
  readonly mode = 'foot' as const;

  constructor(private readonly data: OfflineRoutingData) {}

  async route(from: LatLng, to: LatLng): Promise<RawRoute[]> {
    const t = this.nearest(this.data.targets, to);
    if (t.d > TARGET_MATCH_M) return [];
    // best anchor = minimises (citizen → anchor) + matrix(anchor → target)
    let best: { a: number; total: number; dur: number } | null = null;
    this.data.anchors.forEach((a, i) => {
      const leg = haversine(from, a);
      const m = this.data.distances[i]?.[t.i];
      if (leg > ANCHOR_MAX_M || m == null) return;
      const total = leg * 1.25 + m;
      if (!best || total < best.total) best = { a: i, total, dur: (this.data.durations[i][t.i] ?? m / 1.3) + (leg * 1.25) / 1.3 };
    });
    if (!best) return [];
    const b = best as { a: number; total: number; dur: number };
    return [{ geometry: [from, this.data.anchors[b.a], to], distanceM: b.total, durationS: b.dur }];
  }

  private nearest(list: LatLng[], p: LatLng) {
    let i = -1;
    let d = Infinity;
    list.forEach((x, k) => {
      const dd = haversine(x, p);
      if (dd < d) {
        d = dd;
        i = k;
      }
    });
    return { i, d };
  }
}
