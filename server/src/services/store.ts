import { EventEmitter } from 'node:events';
import type {
  AssemblyPoint,
  Brigade,
  CitizenStatus,
  CrisisAlert,
  LiveEvent,
  RoadClosure,
  SosSignal,
  Zone,
} from '@shared/types';
import { seedBrigades, seedPoints, ZONES } from '../data/seed';

/** Who should receive an event. */
export type Audience = { kind: 'public' } | { kind: 'dispatch' } | { kind: 'citizen'; citizenId: string };

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

/**
 * In-memory operational state (hot path) + domain event bus.
 * Every mutation goes through `upsert*` which emits a LiveEvent; the realtime
 * layer and the persistent event log subscribe to the bus. Swapping the store
 * for Redis/Postgres only requires re-implementing this class.
 */
export class Store extends EventEmitter {
  zones: Zone[] = ZONES;
  points = new Map<string, AssemblyPoint>();
  closures = new Map<string, RoadClosure>();
  sos = new Map<string, SosSignal>();
  brigades = new Map<string, Brigade>();
  alerts = new Map<string, CrisisAlert>();
  citizens = new Map<string, CitizenStatus>();
  audit: AuditEntry[] = [];
  private seq = 0;

  constructor() {
    super();
    this.setMaxListeners(50);
    this.reset();
  }

  reset() {
    this.points = new Map(seedPoints().map((p) => [p.id, p]));
    this.brigades = new Map(seedBrigades().map((b) => [b.id, b]));
    this.closures.clear();
    this.sos.clear();
    this.alerts.clear();
    this.citizens.clear();
    this.audit = [];
  }

  nextId(prefix: string) {
    this.seq++;
    return `${prefix}-${Date.now().toString(36)}-${this.seq.toString(36)}`;
  }

  publish(event: LiveEvent, audience: Audience) {
    this.emit('event', event, audience);
  }

  upsertPoint(p: AssemblyPoint) {
    p.updatedAt = Date.now();
    this.points.set(p.id, p);
    this.publish({ type: 'point.upsert', data: p }, { kind: 'public' });
  }

  upsertClosure(c: RoadClosure) {
    this.closures.set(c.id, c);
    this.publish({ type: 'closure.upsert', data: c }, { kind: 'public' });
  }

  removeClosure(id: string) {
    if (!this.closures.delete(id)) return false;
    this.publish({ type: 'closure.remove', data: { id } }, { kind: 'public' });
    return true;
  }

  upsertSos(s: SosSignal) {
    s.updatedAt = Date.now();
    this.sos.set(s.id, s);
    this.publish({ type: 'sos.upsert', data: s }, { kind: 'dispatch' });
    this.publish({ type: 'sos.upsert', data: s }, { kind: 'citizen', citizenId: s.citizenId });
  }

  upsertBrigade(b: Brigade) {
    b.updatedAt = Date.now();
    this.brigades.set(b.id, b);
    this.publish({ type: 'brigade.upsert', data: b }, { kind: 'dispatch' });
    // Citizens whose SOS this unit serves see it live on their map
    const citizens = new Set([...b.targetSosIds, ...(b.followSosIds ?? [])].map((id) => this.sos.get(id)?.citizenId).filter(Boolean) as string[]);
    for (const citizenId of citizens) this.publish({ type: 'brigade.upsert', data: b }, { kind: 'citizen', citizenId });
  }

  upsertAlert(a: CrisisAlert) {
    a.updatedAt = Date.now();
    this.alerts.set(a.id, a);
    this.publish({ type: 'alert.upsert', data: a }, { kind: 'dispatch' });
  }

  upsertCitizen(c: CitizenStatus) {
    c.updatedAt = Date.now();
    this.citizens.set(c.citizenId, c);
    this.publish({ type: 'citizen.upsert', data: c }, { kind: 'dispatch' });
  }

  log(actor: string, action: string, details?: Record<string, unknown>) {
    const entry = { at: Date.now(), actor, action, details };
    this.audit.push(entry);
    if (this.audit.length > 5000) this.audit.splice(0, 1000);
    this.emit('audit', entry);
  }

  openClosures() {
    return [...this.closures.values()];
  }
}
