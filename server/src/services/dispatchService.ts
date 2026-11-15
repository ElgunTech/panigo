import type { Brigade, LatLng, SosSignal } from '@shared/types';
import { advanceAlong, haversine, polylineLength } from '../domain/geo';
import type { RoutingService } from '../routing/routingService';
import type { Store } from './store';

const BRIGADE_SPEED_MS = 12; // ~43 km/h with sirens
/** Time a brigade works on scene before the signals are resolved (simulated ms). */
const ON_SCENE_MS = 120_000;
/** A brigade closer than this to an SOS point counts as "arrived" (Brigada çatdı). */
export const ARRIVAL_RADIUS_M = 100;
/** Max SOS points visited in one run — the rest stay open for another unit. */
const MAX_STOPS = 8;

/**
 * Rescue brigade dispatch + movement simulation. A brigade gets a real road
 * route (vehicle profile, avoids closed roads) that visits every assigned SOS
 * point in nearest-neighbour order, so it physically reaches each citizen.
 * It works on scene, resolves the signals and becomes available again.
 */
export class DispatchService {
  /** accumulated simulated on-scene time per brigade */
  private onSceneMs = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly routing: RoutingService,
    private readonly timeScale = 1,
  ) {}

  async assign(brigadeId: string, sosIds: string[], actor: string, target?: LatLng): Promise<Brigade> {
    const b = this.store.brigades.get(brigadeId);
    if (!b) throw new DispatchError('BRIGADE_NOT_FOUND');
    if (b.status !== 'available') throw new DispatchError('BRIGADE_BUSY');
    const open = sosIds.map((id) => this.store.sos.get(id)).filter((s): s is SosSignal => !!s && s.status !== 'resolved' && s.status !== 'cancelled');

    // Stops: the SOS points themselves (nearest-neighbour tour), or an explicit target
    const stops: SosSignal[] = [];
    let cursor = b.location;
    const pool = [...open];
    while (pool.length && stops.length < MAX_STOPS) {
      pool.sort((x, y) => haversine(cursor, x.location) - haversine(cursor, y.location));
      const next = pool.shift()!;
      stops.push(next);
      cursor = next.location;
    }
    const waypoints: LatLng[] = stops.length ? stops.map((s) => s.location) : target ? [target] : [];
    if (!waypoints.length) throw new DispatchError('NO_TARGET');

    const closures = this.store.openClosures();
    const legs = await Promise.all(waypoints.map((w, i) => this.routing.route(i === 0 ? b.location : waypoints[i - 1], w, closures, 'vehicle')));
    const geometry = legs.flatMap((l, i) => (i === 0 ? l.geometry : l.geometry.slice(1)));

    b.status = 'en_route';
    b.target = waypoints[waypoints.length - 1];
    b.route = geometry;
    b.etaS = Math.round(polylineLength(geometry) / BRIGADE_SPEED_MS);
    b.targetSosIds = stops.map((s) => s.id);
    this.onSceneMs.delete(b.id);
    this.store.upsertBrigade(b);
    for (const s of stops) {
      s.status = 'assigned';
      s.brigadeId = b.id;
      this.store.upsertSos(s);
    }
    this.store.log(actor, 'brigade.dispatch', { brigadeId, sosIds: b.targetSosIds, stops: waypoints.length });
    return b;
  }

  /** Simulation tick — advance brigades along their routes. */
  tick(dtMs: number) {
    const simMs = dtMs * this.timeScale;
    for (const b of this.store.brigades.values()) {
      if (b.status === 'en_route' && b.route) {
        const { position, rest, arrived } = advanceAlong(b.route, (BRIGADE_SPEED_MS * simMs) / 1000);
        b.location = position;
        b.route = rest;
        b.etaS = Math.max(0, Math.round(polylineLength(rest) / BRIGADE_SPEED_MS));
        if (arrived) {
          b.status = 'on_scene';
          b.route = undefined;
          b.etaS = 0;
          this.onSceneMs.set(b.id, 0);
        }
        this.markArrivals(b);
        this.store.upsertBrigade(b);
      } else if (b.status === 'on_scene') {
        const t = (this.onSceneMs.get(b.id) ?? 0) + simMs;
        this.onSceneMs.set(b.id, t);
        if (t >= ON_SCENE_MS) this.complete(b);
      }
    }
  }

  /** Server-side arrival detection: brigade within 100 m of an assigned SOS point. */
  private markArrivals(b: Brigade) {
    for (const id of b.targetSosIds) {
      const s = this.store.sos.get(id);
      if (s && s.status === 'assigned' && !s.arrivedAt && haversine(b.location, s.location) <= ARRIVAL_RADIUS_M) {
        s.arrivedAt = Date.now();
        this.store.upsertSos(s);
      }
    }
  }

  private complete(b: Brigade) {
    for (const id of b.targetSosIds) {
      const s = this.store.sos.get(id);
      if (s && s.status === 'assigned') {
        s.status = 'resolved';
        this.store.upsertSos(s);
      }
    }
    this.store.log('system', 'brigade.completed', { brigadeId: b.id, sosIds: b.targetSosIds });
    // Final state goes to the citizens too (they are still in targetSosIds when we publish)
    b.status = 'available';
    b.target = undefined;
    this.onSceneMs.delete(b.id);
    this.store.upsertBrigade(b);
    b.targetSosIds = [];
    this.store.upsertBrigade(b);
  }

  nearestFree(p: LatLng) {
    return [...this.store.brigades.values()]
      .filter((b) => b.status === 'available')
      .sort((a, b) => haversine(a.location, p) - haversine(b.location, p))[0];
  }
}

export class DispatchError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
