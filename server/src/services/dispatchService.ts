import type { Brigade, BrigadeRecommendation, BrigadeType, LatLng, SosSignal } from '@shared/types';
import { HAZARD_TO_BRIGADE } from '../domain/crisisEngine';
import { advanceAlong, haversine, polylineLength } from '../domain/geo';
import type { RoutingService } from '../routing/routingService';
import type { Store } from './store';
import { HOSPITALS } from '../data/seed';

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
    // A unit on its way back can be re-tasked
    if (b.status !== 'available' && b.status !== 'returning') throw new DispatchError('BRIGADE_BUSY');
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
    b.followSosIds = [];
    b.destinationName = undefined;
    b.destinationKind = undefined;
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
      if ((b.status === 'en_route' || b.status === 'returning') && b.route) {
        const { position, rest, arrived } = advanceAlong(b.route, (BRIGADE_SPEED_MS * simMs) / 1000);
        b.location = position;
        b.route = rest;
        b.etaS = Math.max(0, Math.round(polylineLength(rest) / BRIGADE_SPEED_MS));
        if (arrived && b.status === 'returning') {
          this.finishReturn(b);
          continue;
        }
        if (arrived) {
          b.status = 'on_scene';
          b.route = undefined;
          b.etaS = 0;
          this.onSceneMs.set(b.id, 0);
        }
        if (b.status === 'en_route' || b.status === 'on_scene') this.markArrivals(b);
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
    this.onSceneMs.delete(b.id);

    // Return trip: medical units transport to the nearest real hospital, others go back to base.
    // The served citizens keep following the unit on their map (followSosIds).
    const hospital = b.type === 'medical' && HOSPITALS.length ? HOSPITALS.reduce((x, y) => (haversine(b.location, x.location) <= haversine(b.location, y.location) ? x : y)) : undefined;
    const dest = hospital?.location ?? b.base;
    b.status = 'returning';
    b.followSosIds = b.targetSosIds;
    b.targetSosIds = [];
    b.destinationKind = hospital ? 'hospital' : 'base';
    b.destinationName = hospital?.name;
    b.target = dest;
    b.route = [b.location, dest];
    b.etaS = Math.round(haversine(b.location, dest) / BRIGADE_SPEED_MS);
    this.store.upsertBrigade(b);
    void this.routing
      .route(b.location, dest, this.store.openClosures(), 'vehicle')
      .then((r) => {
        if (b.status === 'returning' && b.target === dest) {
          b.route = r.geometry;
          b.etaS = Math.round(polylineLength(r.geometry) / BRIGADE_SPEED_MS);
          this.store.upsertBrigade(b);
        }
      })
      .catch(() => undefined);
  }

  private finishReturn(b: Brigade) {
    b.status = 'available';
    b.route = undefined;
    b.etaS = 0;
    this.store.upsertBrigade(b); // last update still reaches the following citizens
    b.followSosIds = [];
    b.target = undefined;
    b.destinationName = undefined;
    b.destinationKind = undefined;
    this.store.upsertBrigade(b);
  }

  /**
   * Nearest SUITABLE unit for an SOS: the brigade type matching the hazard
   * (medical / Priority #1 → medical, fire → fire, collapse & flood → rescue),
   * chosen by real road travel time (top-3 by distance are routed), falling back
   * to any free unit if no unit of that type is free. Returning units count as free.
   */
  async recommend(sosId: string): Promise<BrigadeRecommendation | null> {
    const s = this.store.sos.get(sosId);
    if (!s) throw new DispatchError('SOS_NOT_FOUND');
    const wanted: BrigadeType = s.priority === 1 ? 'medical' : HAZARD_TO_BRIGADE[s.hazard];
    const free = [...this.store.brigades.values()].filter((b) => b.status === 'available' || b.status === 'returning');
    if (!free.length) return null;
    const matching = free.filter((b) => b.type === wanted);
    const pool = matching.length ? matching : free;
    const top = [...pool].sort((a, b) => haversine(a.location, s.location) - haversine(b.location, s.location)).slice(0, 3);
    const closures = this.store.openClosures();
    const routed = await Promise.all(
      top.map(async (b) => {
        const r = await this.routing.route(b.location, s.location, closures, 'vehicle');
        return { b, distanceM: r.distanceM, etaS: Math.round(r.distanceM / BRIGADE_SPEED_MS) };
      }),
    );
    routed.sort((x, y) => x.etaS - y.etaS);
    const best = routed[0];
    return { brigadeId: best.b.id, brigadeName: best.b.name, brigadeType: best.b.type, wantedType: wanted, matchedType: best.b.type === wanted, distanceM: best.distanceM, etaS: best.etaS };
  }

  /** One-click: dispatch the nearest suitable unit to this SOS. */
  async assignNearest(sosId: string, actor: string) {
    const rec = await this.recommend(sosId);
    if (!rec) throw new DispatchError('NO_FREE_BRIGADE');
    const b = await this.assign(rec.brigadeId, [sosId], actor);
    this.store.log(actor, 'brigade.assign_nearest', { sosId, brigadeId: rec.brigadeId, etaS: rec.etaS, matchedType: rec.matchedType });
    return { brigade: b, recommendation: rec };
  }

  nearestFree(p: LatLng) {
    return [...this.store.brigades.values()]
      .filter((b) => b.status === 'available' || b.status === 'returning')
      .sort((a, b) => haversine(a.location, p) - haversine(b.location, p))[0];
  }
}

export class DispatchError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
