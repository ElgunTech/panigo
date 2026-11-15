import type { AssemblyPoint, Hazard, LatLng, RoadClosure, SosPriority, SosSignal, SystemStatus } from '@shared/types';
import type { AppConfig } from '../config';
import { BARRIERS, zoneOf } from '../data/seed';
import { haversine } from '../domain/geo';
import { ARRIVAL_RADIUS_M } from './dispatchService';
import { RoadNetwork } from '../domain/roadNetwork';
import { OsrmProvider } from '../routing/osrmProvider';
import { RoutingService } from '../routing/routingService';
import { SimulatedProvider } from '../routing/simulatedProvider';
import type { RoutingProvider } from '../routing/types';
import { CrisisService } from './crisisService';
import { DispatchService } from './dispatchService';
import { EvacuationService } from './evacuationService';
import { Store } from './store';

/**
 * Composition root / application façade. HTTP & WebSocket adapters only talk
 * to this class, so transports, storage or providers can be swapped without
 * touching domain logic (hexagonal architecture).
 */
export class Engine {
  readonly store = new Store();
  readonly routing: RoutingService;
  readonly evacuation: EvacuationService;
  readonly dispatch: DispatchService;
  readonly crisis: CrisisService;
  readonly startedAt = Date.now();
  scenarioRunning = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    readonly config: AppConfig,
    providers?: RoutingProvider[],
  ) {
    this.routing = new RoutingService(providers ?? buildProviders(config), undefined, BARRIERS);
    this.evacuation = new EvacuationService(this.store, this.routing);
    this.dispatch = new DispatchService(this.store, this.routing, config.timeScale);
    this.crisis = new CrisisService(this.store, this.dispatch, this.evacuation);
  }

  // ---------- Citizen ----------
  /**
   * @param specialNeeds sender has reduced mobility (role mobility_impaired) →
   *   SOS is auto-escalated to Priority #1 (Kritik Prioritet) and raises an immediate alert.
   */
  createSos(citizenId: string, hazard: Hazard, location: LatLng, note?: string, specialNeeds = false): SosSignal {
    const now = Date.now();
    const priority: SosPriority = specialNeeds ? 1 : 2;
    const sos: SosSignal = {
      id: this.store.nextId('sos'),
      citizenId,
      hazard,
      location,
      zoneId: zoneOf(location).id,
      note,
      status: 'new',
      priority,
      specialNeeds,
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsertSos(sos);
    if (priority === 1) this.crisis.raisePriority(sos);
    const c = this.store.citizens.get(citizenId);
    this.store.upsertCitizen({ ...(c ?? { citizenId }), citizenId, safe: false, location, updatedAt: now });
    this.crisis.evaluateSos(sos);
    return sos;
  }

  /**
   * Citizen confirms "Briqada çatdı". Validated against the brigade's live position
   * (≤ 100 m + small GPS/tick tolerance) — the client cannot confirm from afar.
   */
  confirmArrival(citizenId: string, sosId: string) {
    const s = this.store.sos.get(sosId);
    if (!s || s.citizenId !== citizenId) return { error: 'SOS_NOT_FOUND' as const };
    const b = s.brigadeId ? this.store.brigades.get(s.brigadeId) : undefined;
    if (!b || !b.targetSosIds.includes(s.id) || s.status !== 'assigned') return { error: 'BRIGADE_NOT_ASSIGNED' as const };
    const distanceM = Math.round(haversine(b.location, s.location));
    if (distanceM > ARRIVAL_RADIUS_M + 20) return { error: 'BRIGADE_TOO_FAR' as const, distanceM };
    s.confirmedAt = Date.now();
    s.arrivedAt ??= s.confirmedAt;
    this.store.upsertSos(s);
    this.store.log(citizenId, 'sos.arrival_confirmed', { sosId, brigadeId: b.id, distanceM });
    return { sos: s, distanceM };
  }

  /** Brigades currently serving this citizen's signals (for the citizen map). */
  brigadesFor(citizenId: string) {
    return [...this.store.brigades.values()].filter((b) => b.targetSosIds.some((id) => this.store.sos.get(id)?.citizenId === citizenId));
  }

  cancelSos(citizenId: string, sosId: string) {
    const s = this.store.sos.get(sosId);
    if (!s || s.citizenId !== citizenId) return null;
    if (s.status === 'new') {
      s.status = 'cancelled';
      this.store.upsertSos(s);
    }
    return s;
  }

  markSafe(citizenId: string, safe: boolean, location?: LatLng) {
    const prev = this.store.citizens.get(citizenId);
    const checkedIn = safe ? this.evacuation.release(citizenId, location ?? prev?.location) : undefined;
    if (checkedIn) this.afterPointChange(checkedIn);
    if (safe) {
      // A citizen who is safe no longer needs rescue — withdraw their open SOS
      for (const s of this.store.sos.values()) {
        if (s.citizenId === citizenId && s.status === 'new') {
          s.status = 'cancelled';
          this.store.upsertSos(s);
        }
      }
    }
    const status = {
      citizenId,
      safe,
      location: location ?? prev?.location,
      destinationPointId: safe ? checkedIn?.id : prev?.destinationPointId,
      updatedAt: Date.now(),
    };
    this.store.upsertCitizen(status);
    return { status, checkedIn };
  }

  // ---------- Operator ----------
  async addClosure(input: { name: string; location: LatLng; radiusM: number; reason: string }, actor: string): Promise<{ closure: RoadClosure; rerouted: number }> {
    const closure: RoadClosure = { id: this.store.nextId('road'), createdAt: Date.now(), ...input };
    this.store.upsertClosure(closure);
    this.store.log(actor, 'closure.add', { id: closure.id, name: closure.name });
    const rerouted = await this.evacuation.onClosureAdded(closure);
    return { closure, rerouted };
  }

  removeClosure(id: string, actor: string) {
    const ok = this.store.removeClosure(id);
    if (ok) this.store.log(actor, 'closure.remove', { id });
    return ok;
  }

  async updatePoint(id: string, patch: { occupancy?: number; status?: AssemblyPoint['status'] }, actor: string) {
    const p = this.store.points.get(id);
    if (!p) return null;
    if (patch.occupancy !== undefined) p.occupancy = Math.max(0, Math.min(p.capacity, Math.round(patch.occupancy)));
    if (patch.status) p.status = patch.status;
    this.store.upsertPoint(p);
    this.store.log(actor, 'point.update', { id, ...patch });
    await this.afterPointChange(p);
    return p;
  }

  private async afterPointChange(p: AssemblyPoint) {
    this.crisis.evaluatePoint(p);
    await this.evacuation.onPointChanged(p);
  }

  systemStatus(): SystemStatus {
    return {
      providers: this.routing.health(),
      scenarioRunning: this.scenarioRunning,
      uptimeS: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }

  metrics() {
    const sos = [...this.store.sos.values()];
    return {
      sosTotal: sos.length,
      sosOpen: sos.filter((s) => s.status === 'new' || s.status === 'assigned').length,
      alertsOpen: [...this.store.alerts.values()].filter((a) => a.status === 'open').length,
      activeEvacuations: this.evacuation.activeSessions(),
      reroutes: this.evacuation.stats.reroutes,
      routing: this.routing.stats,
      memoryMb: Math.round(process.memoryUsage().rss / 1e6),
    };
  }

  // ---------- Simulation ----------
  start() {
    const tick = 1000;
    this.timers.push(setInterval(() => this.dispatch.tick(tick), tick));
    this.timers.push(setInterval(() => this.store.publish({ type: 'system.status', data: this.systemStatus() }, { kind: 'dispatch' }), 5000));
  }

  /** Earthquake drill: SOS bursts, road closures and crowds converging on points. */
  async runScenario(actor: string, epicenter: LatLng = { lat: 40.3795, lng: 49.8485 }) {
    if (this.scenarioRunning) return false;
    this.scenarioRunning = true;
    this.store.log(actor, 'scenario.start', { epicenter });
    const hazards: Hazard[] = ['collapse', 'collapse', 'fire', 'medical', 'flood', 'medical'];
    const jitter = (m: number) => (Math.random() - 0.5) * m;
    let step = 0;
    await this.addClosure({ name: 'Neftçilər prospekti', location: { lat: 40.3722, lng: 49.8420 }, radiusM: 260, reason: 'Bina dağıntısı' }, 'scenario');
    const t = setInterval(async () => {
      step++;
      const loc = { lat: epicenter.lat + jitter(0.008), lng: epicenter.lng + jitter(0.01) };
      this.createSos(`sim-${Math.floor(Math.random() * 1e6)}`, hazards[step % hazards.length], loc);
      // Crowds converge on the nearest open points
      const near = [...this.store.points.values()].filter((p) => p.status === 'open').sort((a, b) => dist(a.location, epicenter) - dist(b.location, epicenter)).slice(0, 3);
      for (const p of near) {
        p.occupancy = Math.min(p.capacity, p.occupancy + Math.round(p.capacity * (0.01 + Math.random() * 0.025)));
        this.store.upsertPoint(p);
        await this.afterPointChange(p);
      }
      if (step === 6) await this.addClosure({ name: 'Azadlıq prospekti', location: { lat: 40.3990, lng: 49.8440 }, radiusM: 250, reason: 'Qaz sızması' }, 'scenario');
      if (step >= 14) {
        clearInterval(t);
        this.scenarioRunning = false;
        this.store.log('scenario', 'scenario.end');
        this.store.publish({ type: 'system.status', data: this.systemStatus() }, { kind: 'dispatch' });
      }
    }, 2500);
    this.timers.push(t);
    this.store.publish({ type: 'system.status', data: this.systemStatus() }, { kind: 'dispatch' });
    return true;
  }

  reset(actor: string) {
    this.store.reset();
    this.evacuation.reset();
    this.routing.invalidate();
    this.store.log(actor, 'system.reset');
  }

  stop() {
    this.timers.forEach(clearInterval);
  }
}

const dist = (a: LatLng, b: LatLng) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;

function buildProviders(cfg: AppConfig): RoutingProvider[] {
  const registry: Record<string, () => RoutingProvider> = {
    'osrm-foot': () => new OsrmProvider('osrm-foot', cfg.osrmFootUrl, 'foot', 'foot', ['standard', 'accessible'], cfg.osrmTimeoutMs),
    osrm: () => new OsrmProvider('osrm', cfg.osrmUrl, 'driving', 'vehicle', ['vehicle', 'accessible'], cfg.osrmTimeoutMs),
    simulated: () => new SimulatedProvider(new RoadNetwork(), BARRIERS),
  };
  return cfg.routingProviders.filter((id) => registry[id]).map((id) => registry[id]());
}
