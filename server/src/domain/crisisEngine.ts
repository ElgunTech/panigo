import { CRISIS_RULES, type AssemblyPoint, type Brigade, type BrigadeType, type CrisisAlert, type Hazard, type LatLng, type SosSignal } from '@shared/types';
import { centroid, haversine } from './geo';

/**
 * Critical-crisis algorithm (pure functions — no I/O, fully unit-testable).
 *
 * Rule A (SOS cluster): at least `minDistinct` SOS signals from DIFFERENT
 *   citizens within `windowMs`, either in the same zone OR within `radiusM`
 *   of the newest signal.
 * Rule B (capacity): an assembly point's occupancy exceeds `capacityAlertPct`.
 */

export interface CrisisRules {
  sosWindowMs: number;
  sosRadiusM: number;
  sosMinDistinct: number;
  capacityAlertPct: number;
}

export const DEFAULT_RULES: CrisisRules = { ...CRISIS_RULES };

export interface SosCluster {
  zoneId: string;
  center: LatLng;
  sosIds: string[];
  distinctCitizens: number;
  dominantHazard: Hazard;
}

export function detectSosCluster(trigger: SosSignal, all: SosSignal[], now: number, rules: CrisisRules = DEFAULT_RULES): SosCluster | null {
  // Only unanswered signals count: SOS already covered by a dispatched brigade
  // must not re-trigger the same alert right after the operator acted on it.
  const members = all.filter(
    (s) =>
      s.status === 'new' &&
      now - s.createdAt <= rules.sosWindowMs &&
      (s.zoneId === trigger.zoneId || haversine(s.location, trigger.location) <= rules.sosRadiusM),
  );
  if (trigger.status === 'new' && !members.some((m) => m.id === trigger.id)) members.push(trigger);
  const citizens = new Set(members.map((m) => m.citizenId));
  if (citizens.size < rules.sosMinDistinct) return null;

  const counts = new Map<Hazard, number>();
  for (const m of members) counts.set(m.hazard, (counts.get(m.hazard) ?? 0) + 1);
  const dominantHazard = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  return {
    zoneId: trigger.zoneId,
    center: centroid(members.map((m) => m.location)),
    sosIds: members.map((m) => m.id),
    distinctCitizens: citizens.size,
    dominantHazard,
  };
}

export function occupancyPct(p: Pick<AssemblyPoint, 'occupancy' | 'capacity'>): number {
  return p.capacity > 0 ? (p.occupancy / p.capacity) * 100 : 100;
}

export function isOverCapacity(p: AssemblyPoint, rules: CrisisRules = DEFAULT_RULES): boolean {
  return p.status === 'open' && occupancyPct(p) > rules.capacityAlertPct;
}

/** An open alert that should absorb a new cluster instead of creating a duplicate. */
export function findMergeableClusterAlert(cluster: SosCluster, alerts: CrisisAlert[], rules: CrisisRules = DEFAULT_RULES): CrisisAlert | undefined {
  return alerts.find(
    (a) =>
      a.kind === 'sos_cluster' &&
      a.status === 'open' &&
      (a.zoneId === cluster.zoneId || haversine(a.center, cluster.center) <= rules.sosRadiusM),
  );
}

const HAZARD_TO_BRIGADE: Record<Hazard, BrigadeType> = {
  fire: 'fire',
  collapse: 'rescue',
  flood: 'rescue',
  medical: 'medical',
};

/** Nearest available brigade, preferring one specialised for the hazard. */
export function pickBrigade(target: LatLng, hazard: Hazard, brigades: Brigade[]): Brigade | undefined {
  const free = brigades.filter((b) => b.status === 'available');
  if (!free.length) return undefined;
  const wanted = HAZARD_TO_BRIGADE[hazard];
  // 1.6x distance penalty for non-specialised units
  return free
    .map((b) => ({ b, score: haversine(b.location, target) * (b.type === wanted ? 1 : 1.6) }))
    .sort((x, y) => x.score - y.score)[0].b;
}

/** Nearest reserve point to open near the pressure centre. */
export function pickReservePoint(target: LatLng, points: AssemblyPoint[]): AssemblyPoint | undefined {
  return points
    .filter((p) => p.status === 'reserve')
    .sort((a, b) => haversine(a.location, target) - haversine(b.location, target))[0];
}
