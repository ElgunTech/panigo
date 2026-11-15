import type { Barrier, LatLng, RoadClosure, RouteProfile } from '@shared/types';
import { pointToSegment, polylineLength } from '../domain/geo';
import { RoadNetwork } from '../domain/roadNetwork';
import type { RawRoute, RoutingProvider } from './types';

/** Edge cost multiplier per nearby stair/underpass for the accessible profile. */
const BARRIER_PENALTY = 4;
const BARRIER_RADIUS_M = 60;

/**
 * Internal routing engine on the simulated road graph — closure-aware and never offline.
 * For `accessible` it additionally steers away from real OSM stairs / stair-underpasses
 * (soft penalty so the graph never disconnects), i.e. a step-free wheelchair route.
 */
export class SimulatedProvider implements RoutingProvider {
  readonly id = 'simulated' as const;
  readonly closureAware = true;
  /** abstract street lattice — serves every profile as the always-available fallback */
  readonly mode = 'foot' as const;
  /** average urban driving speed under crisis traffic, m/s */
  private readonly speed = 7;
  private barrierCost?: Map<string, number>;

  constructor(
    private readonly network = new RoadNetwork(),
    private readonly barriers: Barrier[] = [],
  ) {}

  async route(from: LatLng, to: LatLng, closures: RoadClosure[], profile: RouteProfile = 'standard'): Promise<RawRoute[]> {
    const weight = profile === 'accessible' && this.barriers.length ? this.accessibleWeight() : undefined;
    const path = this.network.shortestPath(from, to, closures, weight);
    if (!path) return [];
    const distanceM = polylineLength(path);
    return [{ geometry: path, distanceM, durationS: distanceM / this.speed }];
  }

  /** Lazily pre-computes a barrier penalty per graph edge (O(E·B) once, then O(1) lookups). */
  private accessibleWeight() {
    if (!this.barrierCost) {
      this.barrierCost = new Map();
      for (const n of this.network.nodes) {
        for (const m of this.network.neighbours(n.id)) {
          if (m <= n.id) continue;
          const b = this.network.nodes[m];
          let hits = 0;
          for (const x of this.barriers) if (pointToSegment(x, n.pos, b.pos) <= BARRIER_RADIUS_M) hits++;
          if (hits) this.barrierCost.set(edgeKey(n.pos, b.pos), 1 + hits * BARRIER_PENALTY);
        }
      }
    }
    const cost = this.barrierCost;
    return (a: LatLng, b: LatLng) => cost.get(edgeKey(a, b)) ?? 1;
  }
}

function edgeKey(a: LatLng, b: LatLng) {
  const k1 = `${a.lat},${a.lng}`;
  const k2 = `${b.lat},${b.lng}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}
