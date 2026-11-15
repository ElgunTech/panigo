import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { EvacuationPlan } from '@shared/types';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { polylineHitsCircle } from '../src/domain/geo';

const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, sosPerCitizenPerMin: 3, rateLimitPerMin: 10_000 });

let engine: Engine;
let app: ReturnType<typeof createApp>;
let op: string;

const citizen = async () => (await request(app).post('/api/auth/citizen')).body.token as string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const NASIMI = { lat: 40.3889, lng: 49.8413 };

beforeEach(async () => {
  engine = new Engine(cfg);
  app = createApp(engine, cfg);
  const r = await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' });
  op = r.body.token;
});

describe('security', () => {
  it('rejects wrong credentials', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'nope' });
    expect(r.status).toBe(401);
  });
  it('requires auth for the dispatcher snapshot', async () => {
    expect((await request(app).get('/api/dispatch/snapshot')).status).toBe(401);
  });
  it('forbids citizens from operator endpoints (RBAC)', async () => {
    const t = await citizen();
    expect((await request(app).get('/api/dispatch/snapshot').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/sim/outage').set(auth(t)).send({ provider: 'osrm', down: true })).status).toBe(403);
  });
  it('rejects tampered tokens', async () => {
    const t = (await citizen()) + 'x';
    expect((await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'fire', location: NASIMI })).status).toBe(401);
  });
  it('validates SOS payloads', async () => {
    const t = await citizen();
    expect((await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'alien', location: NASIMI })).status).toBe(400);
    expect((await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'fire', location: { lat: 0, lng: 0 } })).status).toBe(400);
  });
  it('throttles SOS spam per citizen', async () => {
    const t = await citizen();
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'fire', location: NASIMI })).status);
    expect(codes).toEqual([201, 201, 201, 429]);
  });
  it('sets security headers', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('Module 1 — citizen evacuation', () => {
  it('returns nearest point with occupancy and route', async () => {
    const t = await citizen();
    const r = await request(app).post('/api/citizen/plan').set(auth(t)).send({ location: NASIMI });
    expect(r.status).toBe(200);
    const plan = r.body as EvacuationPlan;
    expect(plan.destination).toBeTruthy();
    expect(plan.route!.geometry.length).toBeGreaterThan(1);
    expect(plan.options[0].occupancyPct).toBeGreaterThanOrEqual(0);
  });

  it('automatically re-routes when the destination reaches 90%', async () => {
    const t = await citizen();
    const first = (await request(app).post('/api/citizen/plan').set(auth(t)).send({ location: NASIMI })).body as EvacuationPlan;
    await request(app).patch(`/api/dispatch/points/${first.destination!.id}`).set(auth(op)).send({ occupancyPct: 91 }).expect(200);
    const me = (await request(app).get('/api/citizen/me').set(auth(t))).body;
    expect(me.plan.reason).toBe('point_full');
    expect(me.plan.destination.id).not.toBe(first.destination!.id);
    expect(me.plan.previousPointId).toBe(first.destination!.id);
  });

  it('automatically re-routes when a road on the route is closed', async () => {
    const t = await citizen();
    const first = (await request(app).post('/api/citizen/plan').set(auth(t)).send({ location: NASIMI })).body as EvacuationPlan;
    const g = first.route!.geometry;
    const mid = g[Math.floor(g.length / 2)];
    const r = await request(app).post('/api/sim/traffic/closure').set(auth(op)).send({ name: 'Test', location: mid, radiusM: 150 });
    expect(r.status).toBe(201);
    expect(r.body.rerouted).toBe(1);
    const me = (await request(app).get('/api/citizen/me').set(auth(t))).body;
    expect(me.plan.reason).toBe('road_closed');
    expect(polylineHitsCircle(me.plan.route.geometry.slice(1, -1), mid, 150)).toBe(false);
  });

  it('"I am safe" withdraws open SOS and ends the evacuation session', async () => {
    const t = await citizen();
    await request(app).post('/api/citizen/plan').set(auth(t)).send({ location: NASIMI });
    const s = (await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'medical', location: NASIMI })).body;
    await request(app).post('/api/citizen/status').set(auth(t)).send({ safe: true, location: NASIMI }).expect(200);
    const me = (await request(app).get('/api/citizen/me').set(auth(t))).body;
    expect(me.status.safe).toBe(true);
    expect(me.plan).toBeNull();
    expect(me.sos.find((x: { id: string }) => x.id === s.id).status).toBe('cancelled');
  });
});

describe('Module 2 — critical crisis algorithm end-to-end', () => {
  it('raises a RED alert on 4 distinct SOS and executes it in one click', async () => {
    for (let i = 0; i < 4; i++) {
      const t = await citizen();
      await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'collapse', location: { lat: NASIMI.lat + i * 0.0005, lng: NASIMI.lng } }).expect(201);
    }
    const snap = (await request(app).get('/api/dispatch/snapshot').set(auth(op))).body;
    const alert = snap.alerts.find((a: { kind: string }) => a.kind === 'sos_cluster');
    expect(alert).toBeTruthy();
    expect(alert.status).toBe('open');
    expect(alert.recommendation.brigadeId).toBeTruthy();
    expect(alert.recommendation.newPointId).toBeTruthy();

    const ex = await request(app).post(`/api/dispatch/alerts/${alert.id}/execute`).set(auth(op));
    expect(ex.status).toBe(200);
    expect(ex.body.status).toBe('executed');
    expect(engine.store.brigades.get(ex.body.recommendation.brigadeId)!.status).toBe('en_route');
    expect(engine.store.points.get(ex.body.recommendation.newPointId)!.status).toBe('open');
    // idempotent: a second click is rejected
    expect((await request(app).post(`/api/dispatch/alerts/${alert.id}/execute`).set(auth(op))).status).toBe(409);
  });

  it('does not alert on 3 SOS', async () => {
    for (let i = 0; i < 3; i++) {
      const t = await citizen();
      await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'fire', location: NASIMI });
    }
    expect(engine.store.alerts.size).toBe(0);
  });

  it('raises a capacity alert above 95%', async () => {
    await request(app).patch('/api/dispatch/points/k-denizkenari-milli-park').set(auth(op)).send({ occupancyPct: 96 }).expect(200);
    const a = [...engine.store.alerts.values()].find((x) => x.kind === 'capacity');
    expect(a?.pointId).toBe('k-denizkenari-milli-park');
  });

  it('records operator decisions in the audit log', async () => {
    await request(app).patch('/api/dispatch/points/k-denizkenari-milli-park').set(auth(op)).send({ occupancyPct: 50 });
    const audit = (await request(app).get('/api/dispatch/audit').set(auth(op))).body;
    expect(audit[0]).toMatchObject({ actor: 'dispatcher', action: 'point.update' });
  });
});
