import type { AssemblyPoint, CrisisAlert, Hazard, SosSignal } from '@shared/types';
import {
  DEFAULT_RULES,
  detectSosCluster,
  findMergeableClusterAlert,
  isOverCapacity,
  occupancyPct,
  pickBrigade,
  pickReservePoint,
  type CrisisRules,
} from '../domain/crisisEngine';
import type { DispatchService } from './dispatchService';
import type { EvacuationService } from './evacuationService';
import type { Store } from './store';

/**
 * Module 2 core: runs the critical-crisis algorithm on every SOS / occupancy
 * change, raises RED alerts with a concrete recommendation and executes the
 * dispatcher's one-click decision (send brigade + open reserve point).
 */
export class CrisisService {
  constructor(
    private readonly store: Store,
    private readonly dispatch: DispatchService,
    private readonly evacuation: EvacuationService,
    private readonly rules: CrisisRules = DEFAULT_RULES,
  ) {}

  evaluateSos(trigger: SosSignal): CrisisAlert | null {
    const now = Date.now();
    // Only scan the time window — O(window) instead of O(all SOS) under load
    const recent: SosSignal[] = [];
    for (const s of this.store.sos.values()) if (now - s.createdAt <= this.rules.sosWindowMs) recent.push(s);
    const cluster = detectSosCluster(trigger, recent, now, this.rules);
    if (!cluster) return null;

    const existing = findMergeableClusterAlert(cluster, [...this.store.alerts.values()], this.rules);
    if (existing) {
      existing.sosIds = [...new Set([...existing.sosIds, ...cluster.sosIds])];
      existing.distinctCitizens = Math.max(existing.distinctCitizens, cluster.distinctCitizens);
      existing.center = cluster.center;
      existing.recommendation = this.recommend(cluster.center, cluster.dominantHazard);
      this.store.upsertAlert(existing);
      return existing;
    }
    const alert: CrisisAlert = {
      id: this.store.nextId('alert'),
      kind: 'sos_cluster',
      zoneId: cluster.zoneId,
      center: cluster.center,
      sosIds: cluster.sosIds,
      distinctCitizens: cluster.distinctCitizens,
      status: 'open',
      recommendation: this.recommend(cluster.center, cluster.dominantHazard),
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsertAlert(alert);
    this.store.log('system', 'alert.raised', { alertId: alert.id, kind: alert.kind, zoneId: alert.zoneId, sos: alert.sosIds.length });
    return alert;
  }

  /** Priority #1 SOS (special-needs citizen): immediate RED alert, medical transport recommended. */
  raisePriority(sos: SosSignal): CrisisAlert {
    const now = Date.now();
    const alert: CrisisAlert = {
      id: this.store.nextId('alert'),
      kind: 'priority_sos',
      zoneId: sos.zoneId,
      center: sos.location,
      sosIds: [sos.id],
      distinctCitizens: 1,
      status: 'open',
      // medical brigade = accessible transport (stretcher / wheelchair lift); no new point needed
      recommendation: { brigadeId: pickBrigade(sos.location, 'medical', [...this.store.brigades.values()])?.id },
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsertAlert(alert);
    this.store.log('system', 'alert.raised', { alertId: alert.id, kind: alert.kind, sosId: sos.id, priority: 1 });
    return alert;
  }

  evaluatePoint(point: AssemblyPoint): CrisisAlert | null {
    if (!isOverCapacity(point, this.rules)) return null;
    const open = [...this.store.alerts.values()].find((a) => a.kind === 'capacity' && a.pointId === point.id && a.status === 'open');
    const pct = Math.round(occupancyPct(point) * 10) / 10;
    if (open) {
      if (open.occupancyPct !== pct) {
        open.occupancyPct = pct;
        this.store.upsertAlert(open);
      }
      return open;
    }
    const now = Date.now();
    const alert: CrisisAlert = {
      id: this.store.nextId('alert'),
      kind: 'capacity',
      zoneId: point.zoneId,
      center: point.location,
      sosIds: [],
      distinctCitizens: 0,
      pointId: point.id,
      occupancyPct: pct,
      status: 'open',
      recommendation: this.recommend(point.location, 'collapse'),
      createdAt: now,
      updatedAt: now,
    };
    this.store.upsertAlert(alert);
    this.store.log('system', 'alert.raised', { alertId: alert.id, kind: alert.kind, pointId: point.id, pct });
    return alert;
  }

  private recommend(center: SosSignal['location'], hazard: Hazard) {
    return {
      brigadeId: pickBrigade(center, hazard, [...this.store.brigades.values()])?.id,
      newPointId: pickReservePoint(center, [...this.store.points.values()])?.id,
    };
  }

  /** One-click execution of the recommendation. Idempotent per alert. */
  async execute(alertId: string, actor: string): Promise<CrisisAlert> {
    const alert = this.store.alerts.get(alertId);
    if (!alert) throw new CrisisError('ALERT_NOT_FOUND', 404);
    if (alert.status !== 'open') throw new CrisisError('ALERT_ALREADY_DECIDED', 409);

    // Re-validate at decision time — state may have changed since the alert was raised
    const hazard = alert.kind === 'priority_sos' ? 'medical' : this.dominantHazard(alert);
    const brigade =
      (alert.recommendation.brigadeId && this.store.brigades.get(alert.recommendation.brigadeId)?.status === 'available'
        ? this.store.brigades.get(alert.recommendation.brigadeId)
        : undefined) ?? pickBrigade(alert.center, hazard, [...this.store.brigades.values()]);
    const recommendedReserve =
      alert.recommendation.newPointId && this.store.points.get(alert.recommendation.newPointId)?.status === 'reserve'
        ? this.store.points.get(alert.recommendation.newPointId)
        : undefined;
    // A Priority #1 alert needs accessible transport, not a new assembly point
    const reserve = alert.kind === 'priority_sos' ? undefined : (recommendedReserve ?? pickReservePoint(alert.center, [...this.store.points.values()]));

    const outcome: string[] = [];
    if (brigade) {
      const pending = alert.sosIds.filter((id) => this.store.sos.get(id)?.status === 'new');
      // Visit every pending SOS point; capacity alerts (no SOS) go to the point itself
      await this.dispatch.assign(brigade.id, pending, actor, pending.length ? undefined : alert.center);
      outcome.push(`brigade:${brigade.id}`);
    } else outcome.push('brigade:none_available');

    if (alert.kind === 'priority_sos') {
      /* single special-needs citizen: transport, not a new assembly point */
    } else if (reserve) {
      reserve.status = 'open';
      this.store.upsertPoint(reserve);
      outcome.push(`point:${reserve.id}`);
      // Citizens heading to the overloaded point are re-planned (may pick the new one)
      if (alert.pointId) {
        const p = this.store.points.get(alert.pointId);
        if (p) await this.evacuation.onPointChanged(p);
      }
    } else outcome.push('point:none_in_reserve');

    alert.status = 'executed';
    alert.decidedBy = actor;
    alert.outcome = outcome.join(',');
    alert.recommendation = { brigadeId: brigade?.id, newPointId: reserve?.id };
    this.store.upsertAlert(alert);
    this.store.log(actor, 'alert.executed', { alertId, outcome: alert.outcome });
    return alert;
  }

  dismiss(alertId: string, actor: string): CrisisAlert {
    const alert = this.store.alerts.get(alertId);
    if (!alert) throw new CrisisError('ALERT_NOT_FOUND', 404);
    if (alert.status !== 'open') throw new CrisisError('ALERT_ALREADY_DECIDED', 409);
    alert.status = 'dismissed';
    alert.decidedBy = actor;
    this.store.upsertAlert(alert);
    this.store.log(actor, 'alert.dismissed', { alertId });
    return alert;
  }

  private dominantHazard(alert: CrisisAlert): Hazard {
    const counts = new Map<Hazard, number>();
    for (const id of alert.sosIds) {
      const s = this.store.sos.get(id);
      if (s) counts.set(s.hazard, (counts.get(s.hazard) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'collapse';
  }
}

export class CrisisError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
