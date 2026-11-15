import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';
import { haversine } from '../src/domain/geo';

/** Citizen sees the SOS point + the assigned brigade live; "Briqada çatdı" only within 100 m. */
const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000, timeScale: 1 });
const NASIMI = { lat: 40.3889, lng: 49.8413 };
let engine: Engine;
let app: ReturnType<typeof createApp>;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const citizen = (await request(app).post('/api/auth/guest')).body.token as string;
  const sos = (await request(app).post('/api/citizen/sos').set(auth(citizen)).send({ hazard: 'medical', location: NASIMI })).body;
  const op = (await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token as string;
  const brigade = [...engine.store.brigades.values()].find((b) => b.type === 'medical')!;
  await request(app).post('/api/dispatch/assign').set(auth(op)).send({ brigadeId: brigade.id, sosIds: [sos.id] }).expect(200);
  return { citizen, sos, brigade };
}

/** Advance the simulation until the brigade is within `m` metres of the point (or arrives). */
function driveUntil(brigadeId: string, point: { lat: number; lng: number }, m: number) {
  for (let i = 0; i < 20_000; i++) {
    const b = engine.store.brigades.get(brigadeId)!;
    if (haversine(b.location, point) <= m || b.status !== 'en_route') return;
    engine.dispatch.tick(250);
  }
}

beforeEach(() => {
  engine = new Engine(cfg);
  app = createApp(engine, cfg, new UserRepository(null));
});

describe('citizen view of the assigned brigade', () => {
  it('returns the serving brigade with its live position and route', async () => {
    const { citizen, brigade } = await setup();
    const me = (await request(app).get('/api/citizen/me').set(auth(citizen))).body;
    expect(me.brigades.map((b: { id: string }) => b.id)).toEqual([brigade.id]);
    expect(me.brigades[0].status).toBe('en_route');
    expect(me.brigades[0].route.length).toBeGreaterThan(1);
  });

  it('the brigade route ends at the SOS point itself (not a cluster centroid)', async () => {
    const { sos, brigade } = await setup();
    const b = engine.store.brigades.get(brigade.id)!;
    expect(haversine(b.target!, sos.location)).toBeLessThan(1);
  });
});

describe('"Briqada çatdı" confirmation', () => {
  it('is rejected while the brigade is far away', async () => {
    const { citizen, sos, brigade } = await setup();
    const b = engine.store.brigades.get(brigade.id)!;
    expect(haversine(b.location, sos.location)).toBeGreaterThan(200);
    const r = await request(app).post(`/api/citizen/sos/${sos.id}/arrived`).set(auth(citizen));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('BRIGADE_TOO_FAR');
  });

  it('server marks arrival within 100 m and accepts the citizen confirmation', async () => {
    const { citizen, sos, brigade } = await setup();
    driveUntil(brigade.id, sos.location, 90);
    expect(engine.store.sos.get(sos.id)!.arrivedAt).toBeTruthy();
    const r = await request(app).post(`/api/citizen/sos/${sos.id}/arrived`).set(auth(citizen));
    expect(r.status).toBe(200);
    expect(r.body.sos.confirmedAt).toBeTruthy();
    expect(r.body.distanceM).toBeLessThanOrEqual(100);
    const audit = (await request(app).get('/api/dispatch/audit').set(auth((await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token))).body;
    expect(audit.some((a: { action: string }) => a.action === 'sos.arrival_confirmed')).toBe(true);
  });

  it('after the job the citizen keeps seeing where the brigade goes (medical → nearest hospital)', async () => {
    const { citizen, sos, brigade } = await setup();
    driveUntil(brigade.id, sos.location, 90);
    await request(app).post(`/api/citizen/sos/${sos.id}/arrived`).set(auth(citizen)).expect(200);
    // finish driving + on-scene work
    for (let i = 0; i < 2000 && engine.store.brigades.get(brigade.id)!.status !== 'returning'; i++) engine.dispatch.tick(1000);
    const b = engine.store.brigades.get(brigade.id)!;
    expect(b.status).toBe('returning');
    expect(b.destinationKind).toBe('hospital');
    expect(b.destinationName).toBeTruthy();
    expect(engine.store.sos.get(sos.id)!.status).toBe('resolved');
    const me = (await request(app).get('/api/citizen/me').set(auth(citizen))).body;
    expect(me.brigades[0]).toMatchObject({ id: brigade.id, status: 'returning' });
    // once at the hospital the unit is free again and no longer tracked by the citizen
    for (let i = 0; i < 5000 && engine.store.brigades.get(brigade.id)!.status === 'returning'; i++) engine.dispatch.tick(1000);
    expect(engine.store.brigades.get(brigade.id)!.status).toBe('available');
    expect((await request(app).get('/api/citizen/me').set(auth(citizen))).body.brigades).toHaveLength(0);
  });

  it("another citizen cannot confirm someone else's SOS", async () => {
    const { sos, brigade } = await setup();
    driveUntil(brigade.id, sos.location, 90);
    const other = (await request(app).post('/api/auth/guest')).body.token;
    expect((await request(app).post(`/api/citizen/sos/${sos.id}/arrived`).set(auth(other))).status).toBe(404);
  });

  it('a cluster alert brigade visits every SOS point (each citizen can be reached)', async () => {
    const tokens: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t = (await request(app).post('/api/auth/guest')).body.token;
      tokens.push(t);
      ids.push((await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'collapse', location: { lat: NASIMI.lat + i * 0.002, lng: NASIMI.lng + i * 0.001 } })).body.id);
    }
    const alert = [...engine.store.alerts.values()].find((a) => a.kind === 'sos_cluster')!;
    const op = (await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token;
    const ex = (await request(app).post(`/api/dispatch/alerts/${alert.id}/execute`).set(auth(op))).body;
    const b = engine.store.brigades.get(ex.recommendation.brigadeId)!;
    expect(b.targetSosIds.sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const s = engine.store.sos.get(id)!;
      expect(b.route!.some((p) => haversine(p, s.location) < 5)).toBe(true);
    }
  });
});
