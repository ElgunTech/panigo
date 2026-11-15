import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { OsrmProvider } from '../src/routing/osrmProvider';
import { RoutingService } from '../src/routing/routingService';
import { CircuitBreaker } from '../src/routing/circuitBreaker';
import { RouteArchive, loadOfflineRouting } from '../src/routing/routeArchive';
import { CachedRouteProvider, MatrixProvider } from '../src/routing/offlineProviders';
import { SimulatedProvider } from '../src/routing/simulatedProvider';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';

/**
 * Challenge Drop 2 — the external map/routing API is down (HTTP 503 or > 5 s).
 * A local stub plays the upstream so the real HTTP code paths are exercised.
 */
type Mode = 'ok' | '503' | 'slow';
let mode: Mode = 'ok';
let hits = 0;
let server: http.Server;
let base = '';

const A = { lat: 40.3889, lng: 49.8413 };
const B = { lat: 40.3797, lng: 49.8486 };
const osrmBody = (a: typeof A, b: typeof B) => ({
  code: 'Ok',
  routes: [{ distance: 1423, duration: 1139, geometry: { coordinates: [[a.lng, a.lat], [49.845, 40.385], [b.lng, b.lat]] } }],
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (mode === '503') {
      res.writeHead(503, { 'Retry-After': '60', 'Content-Type': 'text/plain' });
      return res.end('Service Unavailable');
    }
    const send = () => {
      const m = req.url!.match(/\/route\/v1\/\w+\/([\d.]+),([\d.]+);([\d.]+),([\d.]+)/)!;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(osrmBody({ lng: +m[1], lat: +m[2] }, { lng: +m[3], lat: +m[4] })));
    };
    if (mode === 'slow') setTimeout(send, 400);
    else send();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  mode = 'ok';
  hits = 0;
});

const foot = (timeoutMs = 150) => new OsrmProvider('osrm-foot', base, 'foot', 'foot', ['standard', 'accessible'], timeoutMs);

describe('external API failure modes are handled (no exception escapes)', () => {
  it('HTTP 503 → falls back to the local graph, flagged offline', async () => {
    mode = '503';
    const svc = new RoutingService([foot(), new SimulatedProvider()]);
    const r = await svc.route(A, B, []);
    expect(r.provider).toBe('simulated');
    expect(r.offline).toBe(true);
    expect(svc.health()[0].lastError).toContain('503');
  });

  it('response slower than the timeout → treated as outage, falls back', async () => {
    mode = 'slow';
    const svc = new RoutingService([foot(100), new SimulatedProvider()]);
    const t0 = Date.now();
    const r = await svc.route(A, B, []);
    expect(r.offline).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(svc.health()[0].lastError).toMatch(/Timeout/);
  });

  it('circuit opens after 3 failures, honours Retry-After, and stops calling the API', async () => {
    mode = '503';
    const svc = new RoutingService([foot(), new SimulatedProvider()]);
    for (let i = 0; i < 6; i++) await svc.route({ lat: A.lat + i * 0.001, lng: A.lng }, B, []);
    expect(hits).toBe(3);
    const h = svc.health()[0];
    expect(h.state).toBe('open');
    expect(h.retryAt! - Date.now()).toBeGreaterThan(50_000); // Retry-After: 60
    expect(svc.mode()).toBe('offline');
  });

  it('half-open probe closes the circuit again when the API recovers', async () => {
    let now = 1_000_000;
    mode = '503';
    const svc = new RoutingService([foot(), new SimulatedProvider()], () => new CircuitBreaker(3, 30_000, () => now));
    for (let i = 0; i < 3; i++) await svc.route({ lat: A.lat + i * 0.001, lng: A.lng }, B, []);
    expect(svc.health()[0].state).toBe('open');
    mode = 'ok';
    now += 61_000;
    const r = await svc.route({ lat: A.lat + 0.01, lng: A.lng }, B, []);
    expect(r.provider).toBe('osrm-foot');
    expect(r.offline).toBe(false);
    expect(svc.health()[0].state).toBe('closed');
  });
});

describe('local backup database', () => {
  it('serves the LAST CACHED real route when the API goes down', async () => {
    const archive = new RouteArchive(null);
    const svc = new RoutingService([foot(), new CachedRouteProvider(archive), new SimulatedProvider()]);
    svc.archive = archive;
    const online = await svc.route(A, B, []);
    expect(online.provider).toBe('osrm-foot');
    expect(archive.size).toBe(1);

    mode = '503';
    const near = { lat: A.lat + 0.001, lng: A.lng }; // ~110 m away from the cached start
    const offline = await svc.route(near, B, []);
    expect(offline).toMatchObject({ provider: 'cache', offline: true });
    expect(offline.geometry[0]).toEqual(near); // stitched to the citizen's position
    expect(offline.geometry.slice(1)).toEqual(online.geometry); // real street geometry
  });

  it('archive survives a restart (SQLite)', async () => {
    const file = path.join(os.tmpdir(), `panigo-routes-${Date.now()}.db`);
    const a1 = new RouteArchive(file);
    a1.save('standard', A, B, { geometry: [A, B], distanceM: 1400, durationS: 1100 });
    a1.close();
    const a2 = new RouteArchive(file);
    expect(a2.find('standard', A, B)?.distanceM).toBe(1400);
    a2.close();
    fs.rmSync(file, { force: true });
  });

  it('static coordinate matrix gives a real distance/ETA with no live routing at all', async () => {
    const data = loadOfflineRouting();
    expect(data).not.toBeNull();
    expect(data!.anchors.length * data!.targets.length).toBeGreaterThan(5000);
    mode = '503';
    const target = data!.targets[0];
    const from = { lat: data!.anchors[0].lat + 0.001, lng: data!.anchors[0].lng };
    const svc = new RoutingService([foot(), new MatrixProvider(data!)]);
    const r = await svc.route(from, target, []);
    expect(r.provider).toBe('matrix');
    expect(r.offline).toBe(true);
    expect(r.distanceM).toBeGreaterThan(0);
  });
});

describe('end-to-end: citizen keeps being served in offline mode', () => {
  it('plan works during a 503 outage and the status says offline', async () => {
    const cfg = loadConfig({ dbFile: null, routingProviders: ['osrm-foot', 'cache', 'simulated', 'matrix'], osrmFootUrl: base, osrmTimeoutMs: 200, simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000 });
    const engine = new Engine(cfg);
    const app = createApp(engine, cfg, new UserRepository(null));
    const op = (await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token;
    await request(app).post('/api/sim/fault').set({ Authorization: `Bearer ${op}` }).send({ provider: 'external', fault: 'http503' }).expect(200);

    const t = (await request(app).post('/api/auth/guest')).body.token;
    const plan = await request(app).post('/api/citizen/plan').set({ Authorization: `Bearer ${t}` }).send({ location: A });
    expect(plan.status).toBe(200);
    expect(plan.body.route.offline).toBe(true);
    expect(['cache', 'simulated', 'matrix']).toContain(plan.body.route.provider);

    const health = (await request(app).get('/api/health')).body;
    expect(health.routingMode).toBe('offline');
    expect(health.routeCacheSize).toBeGreaterThan(0);

    // recovery
    await request(app).post('/api/sim/fault').set({ Authorization: `Bearer ${op}` }).send({ provider: 'external', fault: 'none' }).expect(200);
    const again = await request(app).post('/api/citizen/plan').set({ Authorization: `Bearer ${t}` }).send({ location: { lat: A.lat + 0.002, lng: A.lng } });
    expect(again.body.route.offline).toBe(false);
    engine.stop();
  });
});
