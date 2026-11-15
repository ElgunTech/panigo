import type { Barrier, Facility, AssemblyPoint, Brigade, CitizenStatus, CrisisAlert, DispatchSnapshot, EvacuationPlan, LiveEvent, RoadClosure, SosSignal, SystemStatus, Zone } from '@shared/types';

/**
 * Normalised client-side read model. Pure reducer → trivially unit-testable
 * and identical for citizen and dispatcher views.
 */
export interface LiveState {
  zones: Zone[];
  hospitals: Facility[];
  barriers: Barrier[];
  points: Record<string, AssemblyPoint>;
  closures: Record<string, RoadClosure>;
  sos: Record<string, SosSignal>;
  brigades: Record<string, Brigade>;
  alerts: Record<string, CrisisAlert>;
  citizens: Record<string, CitizenStatus>;
  plan: EvacuationPlan | null;
  system: SystemStatus | null;
}

export const emptyState: LiveState = {
  zones: [],
  hospitals: [],
  barriers: [],
  points: {},
  closures: {},
  sos: {},
  brigades: {},
  alerts: {},
  citizens: {},
  plan: null,
  system: null,
};

const byId = <T extends { id: string }>(arr: T[] = []) => Object.fromEntries(arr.map((x) => [x.id, x]));

export function fromSnapshot(s: Partial<DispatchSnapshot>, prev: LiveState = emptyState): LiveState {
  return {
    ...prev,
    zones: s.zones ?? prev.zones,
    hospitals: s.hospitals ?? prev.hospitals,
    barriers: s.barriers ?? prev.barriers,
    points: s.points ? byId(s.points) : prev.points,
    closures: s.closures ? byId(s.closures) : prev.closures,
    sos: s.sos ? byId(s.sos) : prev.sos,
    brigades: s.brigades ? byId(s.brigades) : prev.brigades,
    alerts: s.alerts ? byId(s.alerts) : prev.alerts,
    citizens: s.citizens ? Object.fromEntries(s.citizens.map((c) => [c.citizenId, c])) : prev.citizens,
    system: s.system ?? prev.system,
  };
}

const MAX_SOS = 2000;

export function applyEvents(state: LiveState, events: LiveEvent[]): LiveState {
  if (!events.length) return state;
  const next = { ...state };
  const touched = new Set<keyof LiveState>();
  const mut = <K extends 'points' | 'closures' | 'sos' | 'brigades' | 'alerts' | 'citizens'>(k: K) => {
    if (!touched.has(k)) {
      next[k] = { ...state[k] } as LiveState[K];
      touched.add(k);
    }
    return next[k] as Record<string, unknown>;
  };
  for (const e of events) {
    switch (e.type) {
      case 'point.upsert':
        mut('points')[e.data.id] = e.data;
        break;
      case 'closure.upsert':
        mut('closures')[e.data.id] = e.data;
        break;
      case 'closure.remove':
        delete mut('closures')[e.data.id];
        break;
      case 'sos.upsert':
        mut('sos')[e.data.id] = e.data;
        break;
      case 'brigade.upsert':
        mut('brigades')[e.data.id] = e.data;
        break;
      case 'alert.upsert':
        mut('alerts')[e.data.id] = e.data;
        break;
      case 'citizen.upsert':
        mut('citizens')[e.data.citizenId] = e.data;
        break;
      case 'plan.update':
        next.plan = e.data;
        break;
      case 'system.status':
        next.system = e.data;
        break;
    }
  }
  // Bound memory under sustained load: keep the newest SOS only
  if (touched.has('sos')) {
    const ids = Object.keys(next.sos);
    if (ids.length > MAX_SOS) {
      const keep = Object.values(next.sos)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MAX_SOS);
      next.sos = byId(keep);
    }
  }
  return next;
}
