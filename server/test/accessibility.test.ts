import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { EvacuationPlan } from '@shared/types';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';
import { BARRIERS } from '../src/data/seed';
import { RoutingService } from '../src/routing/routingService';
import { SimulatedProvider } from '../src/routing/simulatedProvider';
import { RoadNetwork } from '../src/domain/roadNetwork';

/** Challenge Drop 1 — mobility-impaired / special-care citizens. */
const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000 });
const NASIMI = { lat: 40.3889, lng: 49.8413 };
let engine: Engine;
let app: ReturnType<typeof createApp>;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const guest = async (mobilityImpaired = false) => (await request(app).post('/api/auth/guest').send({ mobilityImpaired })).body;
const login = async (u: string, p: string) => (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;

beforeEach(() => {
  engine = new Engine(cfg);
  app = createApp(engine, cfg, new UserRepository(null));
});

describe('role: mobility_impaired', () => {
  it('can be self-declared at registration (never a staff role)', async () => {
    const r = await request(app).post('/api/auth/register').send({ username: 'kamal', password: 'Wheel123', name: 'Kamal', mobilityImpaired: true });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('mobility_impaired');
  });

  it('admin can assign it', async () => {
    await request(app).post('/api/auth/register').send({ username: 'sevda', password: 'Care1234', name: 'Sevda' });
    const r = await request(app).patch('/api/admin/users/sevda').set(auth(await login('admin', 'admin123'))).send({ role: 'mobility_impaired' });
    expect(r.body.role).toBe('mobility_impaired');
  });

  it('has no dispatcher privileges', async () => {
    const g = await guest(true);
    expect((await request(app).get('/api/dispatch/snapshot').set(auth(g.token))).status).toBe(403);
  });
});

describe('Priority #1 SOS', () => {
  it('SOS from a mobility-impaired citizen is auto-escalated to Priority #1 with an immediate alert', async () => {
    const g = await guest(true);
    const r = await request(app).post('/api/citizen/sos').set(auth(g.token)).send({ hazard: 'collapse', location: NASIMI });
    expect(r.body).toMatchObject({ priority: 1, specialNeeds: true });
    const alert = [...engine.store.alerts.values()].find((a) => a.kind === 'priority_sos');
    expect(alert?.sosIds).toEqual([r.body.id]);
    expect(engine.store.brigades.get(alert!.recommendation.brigadeId!)?.type).toBe('medical'); // medical transport
  });

  it('a regular citizen stays Priority #2 and cannot forge priority in the body', async () => {
    const g = await guest(false);
    const r = await request(app).post('/api/citizen/sos').set(auth(g.token)).send({ hazard: 'fire', location: NASIMI, priority: 1, specialNeeds: true });
    expect(r.body).toMatchObject({ priority: 2, specialNeeds: false });
    expect([...engine.store.alerts.values()].some((a) => a.kind === 'priority_sos')).toBe(false);
  });

  it('one-click execution dispatches transport without opening a new assembly point', async () => {
    const g = await guest(true);
    await request(app).post('/api/citizen/sos').set(auth(g.token)).send({ hazard: 'medical', location: NASIMI });
    const alert = [...engine.store.alerts.values()].find((a) => a.kind === 'priority_sos')!;
    const reserveBefore = [...engine.store.points.values()].filter((p) => p.status === 'reserve').length;
    const ex = await request(app).post(`/api/dispatch/alerts/${alert.id}/execute`).set(auth(await login('dispatcher', 'dispatcher123')));
    expect(ex.status).toBe(200);
    expect(engine.store.brigades.get(ex.body.recommendation.brigadeId)!.status).toBe('en_route');
    expect([...engine.store.points.values()].filter((p) => p.status === 'reserve').length).toBe(reserveBefore);
  });
});

describe('accessible evacuation route', () => {
  it('assigns only step-free / wheelchair-accessible points', async () => {
    const g = await guest(true);
    const plan = (await request(app).post('/api/citizen/plan').set(auth(g.token)).send({ location: NASIMI })).body as EvacuationPlan;
    expect(plan.profile).toBe('accessible');
    expect(plan.route!.profile).toBe('accessible');
    expect(plan.destination!.accessible).toBe(true);
    expect(plan.options.every((o) => o.point.accessible)).toBe(true);
  });

  it('a regular citizen may still be sent to a (non-accessible) metro shelter', async () => {
    const g = await guest(false);
    const plan = (await request(app).post('/api/citizen/plan').set(auth(g.token)).send({ location: NASIMI })).body as EvacuationPlan;
    expect(plan.profile).toBe('standard');
    expect(plan.options.some((o) => !o.point.accessible)).toBe(true);
  });

  it('keeps the accessible profile on automatic re-routing', async () => {
    const g = await guest(true);
    const first = (await request(app).post('/api/citizen/plan').set(auth(g.token)).send({ location: NASIMI })).body as EvacuationPlan;
    await request(app).patch(`/api/dispatch/points/${first.destination!.id}`).set(auth(await login('dispatcher', 'dispatcher123'))).send({ occupancyPct: 93 });
    const me = (await request(app).get('/api/citizen/me').set(auth(g.token))).body;
    expect(me.plan.reason).toBe('point_full');
    expect(me.plan.profile).toBe('accessible');
    expect(me.plan.destination.accessible).toBe(true);
  });

  it('accessible routing passes no more real OSM stairs than the standard route', async () => {
    expect(BARRIERS.length).toBeGreaterThan(100);
    const svc = new RoutingService([new SimulatedProvider(new RoadNetwork(), BARRIERS)], undefined, BARRIERS);
    const from = { lat: 40.377, lng: 49.835 };
    const to = { lat: 40.4, lng: 49.87 };
    const std = await svc.route(from, to, [], 'standard');
    const acc = await svc.route(from, to, [], 'accessible');
    expect(svc.barriersNear(acc.geometry)).toBeLessThanOrEqual(svc.barriersNear(std.geometry));
    expect(acc.walkS).toBeGreaterThan(std.walkS); // wheelchair pace
  });
});
