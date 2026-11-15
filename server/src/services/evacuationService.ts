import { CRISIS_RULES, type AssemblyPoint, type EvacuationPlan, type LatLng, type RerouteReason, type RoadClosure, type RouteProfile } from '@shared/types';
import { haversine, polylineHitsCircle } from '../domain/geo';
import { eligible, rankPoints } from '../domain/recommendation';
import { occupancyPct } from '../domain/crisisEngine';
import type { RoutingService } from '../routing/routingService';
import type { Store } from './store';

interface Session {
  citizenId: string;
  origin: LatLng;
  profile: RouteProfile;
  plan: EvacuationPlan;
}

/**
 * Module 1 core: picks the best assembly point + route for a citizen and keeps
 * the plan valid. Reacts to domain events (road closed, point ≥90% full,
 * point closed) and pushes an automatic alternative route to affected citizens.
 */
export class EvacuationService {
  private sessions = new Map<string, Session>();
  stats = { reroutes: 0 };

  constructor(
    private readonly store: Store,
    private readonly routing: RoutingService,
  ) {}

  /**
   * @param profile 'accessible' (mobility-impaired citizen): only step-free / wheelchair
   *   accessible points + barrier-avoiding route. Defaults to the profile of the existing session.
   */
  async plan(citizenId: string, origin: LatLng, reason: RerouteReason = 'initial', exclude: string[] = [], preferredPointId?: string, profileArg?: RouteProfile): Promise<EvacuationPlan> {
    const profile: RouteProfile = profileArg ?? this.sessions.get(citizenId)?.profile ?? 'standard';
    const closures = this.store.openClosures();
    const options = rankPoints(origin, [...this.store.points.values()], CRISIS_RULES.rerouteFullPct, profile === 'accessible');
    let candidates = eligible(options, exclude);
    if (preferredPointId) {
      const pref = candidates.find((c) => c.point.id === preferredPointId);
      if (pref) candidates = [pref];
    }
    if (!candidates.length) candidates = options.filter((o) => !exclude.includes(o.point.id)); // everything full → least bad
    const top = candidates.slice(0, 3);

    const routed = await Promise.all(top.map(async (o) => ({ o, route: await this.routing.route(origin, o.point.location, closures, profile) })));
    // Final choice: walking time inflated by projected crowding
    routed.sort((a, b) => cost(a.route.walkS, a.o.point) - cost(b.route.walkS, b.o.point));
    const best = routed[0];

    const prev = this.sessions.get(citizenId);
    const prevPointId = prev?.plan.destination?.id;
    const destination = best?.o.point ?? null;
    if (prevPointId !== destination?.id) {
      this.adjustIncoming(prevPointId, -1);
      this.adjustIncoming(destination?.id, +1);
    }

    const plan: EvacuationPlan = {
      citizenId,
      origin,
      options: options.slice(0, 8),
      destination: destination ? this.store.points.get(destination.id)! : null,
      route: best?.route ?? null,
      reason,
      profile,
      previousPointId: reason !== 'initial' && prevPointId !== destination?.id ? prevPointId : undefined,
      createdAt: Date.now(),
    };
    this.sessions.set(citizenId, { citizenId, origin, profile, plan });
    if (reason !== 'initial' && reason !== 'manual') this.stats.reroutes++;

    const status = this.store.citizens.get(citizenId);
    this.store.upsertCitizen({ citizenId, safe: status?.safe ?? false, location: origin, destinationPointId: destination?.id, updatedAt: Date.now() });
    this.store.publish({ type: 'plan.update', data: plan }, { kind: 'citizen', citizenId });
    return plan;
  }

  /** Citizen marked "I'm safe": end the session; if they reached a point, check them in. */
  release(citizenId: string, location?: LatLng): AssemblyPoint | undefined {
    const s = this.sessions.get(citizenId);
    if (!s) return undefined;
    this.sessions.delete(citizenId);
    const dest = s.plan.destination ? this.store.points.get(s.plan.destination.id) : undefined;
    this.adjustIncoming(dest?.id, -1);
    if (dest && location && haversine(location, dest.location) <= 400) {
      dest.occupancy = Math.min(dest.capacity, dest.occupancy + 1);
      this.store.upsertPoint(dest);
      return dest;
    }
    return undefined;
  }

  getPlan(citizenId: string) {
    return this.sessions.get(citizenId)?.plan;
  }

  activeSessions() {
    return this.sessions.size;
  }

  /** A road was closed → re-route every citizen whose route crosses it. */
  async onClosureAdded(closure: RoadClosure) {
    const affected = [...this.sessions.values()].filter(
      (s) => s.plan.route && polylineHitsCircle(s.plan.route.geometry, closure.location, closure.radiusM),
    );
    await Promise.all(affected.map((s) => this.plan(s.citizenId, s.origin, 'road_closed')));
    return affected.length;
  }

  /** A point changed → if ≥90% full or closed, move its incoming citizens elsewhere. */
  async onPointChanged(point: AssemblyPoint) {
    const full = occupancyPct(point) >= CRISIS_RULES.rerouteFullPct;
    const closed = point.status !== 'open';
    if (!full && !closed) return 0;
    const affected = [...this.sessions.values()].filter((s) => s.plan.destination?.id === point.id);
    const reason: RerouteReason = closed ? 'point_closed' : 'point_full';
    await Promise.all(affected.map((s) => this.plan(s.citizenId, s.origin, reason, [point.id])));
    return affected.length;
  }

  private adjustIncoming(pointId: string | undefined, delta: number) {
    if (!pointId) return;
    const p = this.store.points.get(pointId);
    if (!p) return;
    p.incoming = Math.max(0, p.incoming + delta);
    this.store.upsertPoint(p);
  }

  reset() {
    this.sessions.clear();
  }
}

function cost(walkS: number, p: AssemblyPoint) {
  const projected = ((p.occupancy + p.incoming) / p.capacity) * 100;
  return walkS * (projected > 70 ? 1 + (projected - 70) / 20 : 1);
}
