import type { Brigade, LatLng } from '@shared/types';
import { advanceAlong, haversine } from '../domain/geo';
import type { RoutingService } from '../routing/routingService';
import type { Store } from './store';

const BRIGADE_SPEED_MS = 12; // ~43 km/h with sirens
const ON_SCENE_MS = 25_000;

/**
 * Rescue brigade dispatch + movement simulation. A brigade gets a real route
 * (same routing chain as citizens, so it also avoids closed roads), drives
 * along it, works on scene, resolves the SOS signals and becomes available.
 */
export class DispatchService {
  private onSceneSince = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly routing: RoutingService,
    private readonly timeScale = 1,
  ) {}

  async assign(brigadeId: string, sosIds: string[], actor: string, target?: LatLng): Promise<Brigade> {
    const b = this.store.brigades.get(brigadeId);
    if (!b) throw new DispatchError('BRIGADE_NOT_FOUND');
    if (b.status !== 'available') throw new DispatchError('BRIGADE_BUSY');
    const sos = sosIds.map((id) => this.store.sos.get(id)).filter((s) => s && s.status !== 'resolved' && s.status !== 'cancelled');
    const dest = target ?? sos[0]?.location;
    if (!dest) throw new DispatchError('NO_TARGET');

    const route = await this.routing.route(b.location, dest, this.store.openClosures(), 'vehicle');
    b.status = 'en_route';
    b.target = dest;
    b.route = route.geometry;
    b.etaS = Math.round(route.distanceM / BRIGADE_SPEED_MS);
    b.targetSosIds = sos.map((s) => s!.id);
    this.store.upsertBrigade(b);
    for (const s of sos) {
      s!.status = 'assigned';
      s!.brigadeId = b.id;
      this.store.upsertSos(s!);
    }
    this.store.log(actor, 'brigade.dispatch', { brigadeId, sosIds: b.targetSosIds });
    return b;
  }

  /** Simulation tick — advance brigades along their routes. */
  tick(dtMs: number) {
    const now = Date.now();
    for (const b of this.store.brigades.values()) {
      if (b.status === 'en_route' && b.route) {
        const step = (BRIGADE_SPEED_MS * dtMs * this.timeScale) / 1000;
        const { position, rest, arrived } = advanceAlong(b.route, step);
        b.location = position;
        b.route = rest;
        b.etaS = Math.max(0, Math.round((b.etaS ?? 0) - (dtMs * this.timeScale) / 1000));
        if (arrived) {
          b.status = 'on_scene';
          b.route = undefined;
          b.etaS = 0;
          this.onSceneSince.set(b.id, now);
        }
        this.store.upsertBrigade(b);
      } else if (b.status === 'on_scene') {
        const since = this.onSceneSince.get(b.id) ?? now;
        if ((now - since) * this.timeScale >= ON_SCENE_MS) this.complete(b);
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
    b.status = 'available';
    b.targetSosIds = [];
    b.target = undefined;
    this.onSceneSince.delete(b.id);
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
