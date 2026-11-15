import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { SosSignal } from '@shared/types';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { SosGuard } from '../src/security/sosGuard';

/**
 * Challenge Drop 3 — SOS flood / spam attack:
 * rate limiting, duplicate filtering, bot quarantine, JWT/RBAC on dispatcher operations.
 */
const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 100_000, guestPerIpPerMin: 1000, sosPerIpPerMin: 1000, opsPerOperatorPerMin: 1000 });
const NASIMI = { lat: 40.3889, lng: 49.8413 };
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let engine: Engine;
let app: ReturnType<typeof createApp>;
let op: string;

const setup = (over: Parameters<typeof loadConfig>[0] = {}) => {
  const c = { ...cfg, ...over };
  engine = new Engine(c);
  app = createApp(engine, c);
};
const guest = async (ip = '10.0.0.1') => (await request(app).post('/api/auth/guest').set('X-Forwarded-For', ip).send({})).body.token as string;
const sos = (t: string, body: object, ip = '10.0.0.1', headers: Record<string, string> = {}) =>
  request(app).post('/api/citizen/sos').set(auth(t)).set('X-Forwarded-For', ip).set(headers).send(body);
const login = async (u: string, p: string) => (await request(app).post('/api/auth/login').send({ username: u, password: p })).body.token as string;

beforeEach(async () => {
  setup();
  op = await login('dispatcher', 'dispatcher123');
});

describe('Drop 3 · rate limiting', () => {
  it('caps anonymous guest sessions per IP (no identity farming)', async () => {
    setup({ guestPerIpPerMin: 5 });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(app).post('/api/auth/guest').set('X-Forwarded-For', '10.1.1.1').send({})).status);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);
    // another source still gets a session — a real citizen is not locked out by the bot
    expect((await request(app).post('/api/auth/guest').set('X-Forwarded-For', '10.1.1.2').send({})).status).toBe(200);
  });

  it('caps SOS per source IP even when the bot rotates identities', async () => {
    setup({ sosPerIpPerMin: 4 });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t = await guest('10.2.2.2');
      codes.push((await sos(t, { hazard: 'fire', location: { lat: 40.38 + i * 0.003, lng: 49.84 } }, '10.2.2.2')).status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 429, 429]);
    expect(engine.guard.snapshot().rateLimited).toBe(2);
  });
});

describe('Drop 3 · duplicate filter', () => {
  it('a repeated SOS (same hazard, same place) returns the existing signal', async () => {
    const t = await guest();
    const a = await sos(t, { hazard: 'fire', location: NASIMI });
    const b = await sos(t, { hazard: 'fire', location: { lat: NASIMI.lat + 0.0005, lng: NASIMI.lng } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.duplicateOf).toBe(a.body.id);
    expect([...engine.store.sos.values()].filter((s) => s.citizenId === a.body.citizenId)).toHaveLength(1);
    // a different hazard is a new, legitimate signal
    expect((await sos(t, { hazard: 'medical', location: NASIMI })).status).toBe(201);
  });

  it('Idempotency-Key makes a retried request safe', async () => {
    const t = await guest();
    const key = 'retry-key-123456';
    const a = await sos(t, { hazard: 'flood', location: NASIMI }, '10.0.0.1', { 'Idempotency-Key': key });
    const b = await sos(t, { hazard: 'collapse', location: { lat: 40.41, lng: 49.87 } }, '10.0.0.1', { 'Idempotency-Key': key });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
  });
});

describe('Drop 3 · bot quarantine keeps the dispatcher panel clean', () => {
  it('distributed bots with scripted coordinates are quarantined and raise no fake crisis alert', async () => {
    const results: SosSignal[] = [];
    for (let i = 0; i < 40; i++) {
      const ip = `172.16.${i >> 8}.${i & 255}`;
      const t = await guest(ip);
      const r = await sos(t, { hazard: 'collapse', location: NASIMI }, ip);
      expect(r.status).toBe(201);
      expect(r.body.quarantined).toBeUndefined(); // the sender learns nothing
      results.push(r.body);
    }
    const g = engine.guard.snapshot();
    expect(g.quarantined).toBeGreaterThanOrEqual(38);
    // no SOS-cluster red alert from fake traffic
    expect([...engine.store.alerts.values()].filter((a) => a.kind === 'sos_cluster')).toHaveLength(0);
    // the dispatcher feed only holds the few unproven ones
    const snap = (await request(app).get('/api/dispatch/snapshot').set(auth(op))).body;
    expect(snap.sos.length).toBeLessThanOrEqual(2);
    expect(snap.system.guard.quarantined).toBe(g.quarantined);
    // operator can review quarantine
    const q = (await request(app).get('/api/dispatch/quarantine').set(auth(op))).body;
    expect(q.total).toBe(g.quarantined);
    expect(q.items[0].spam.reasons).toContain('coordinate_fingerprint');
  });

  it('operator can release a real signal or reject all spam', async () => {
    for (let i = 0; i < 10; i++) {
      const ip = `172.17.0.${i}`;
      await sos(await guest(ip), { hazard: 'fire', location: NASIMI }, ip);
    }
    const q = (await request(app).get('/api/dispatch/quarantine').set(auth(op))).body;
    const id = q.items[0].id;
    const rel = await request(app).post(`/api/dispatch/quarantine/${id}/release`).set(auth(op));
    expect(rel.status).toBe(200);
    expect(rel.body.quarantined).toBe(false);
    const snap = (await request(app).get('/api/dispatch/snapshot').set(auth(op))).body;
    expect(snap.sos.some((s: SosSignal) => s.id === id)).toBe(true);
    const rej = await request(app).post('/api/dispatch/quarantine/reject-all').set(auth(op)).send({});
    expect(rej.body.rejected).toBe(q.total - 1);
    expect((await request(app).get('/api/dispatch/quarantine').set(auth(op))).body.total).toBe(0);
  });

  it('citizens cannot moderate the quarantine (RBAC)', async () => {
    const t = await guest();
    expect((await request(app).get('/api/dispatch/quarantine').set(auth(t))).status).toBe(403);
    expect((await request(app).post('/api/dispatch/quarantine/reject-all').set(auth(t)).send({})).status).toBe(403);
  });

  it('a registered account in a busy shelter (shared IP) is never quarantined', async () => {
    const r = await request(app).post('/api/auth/register').send({ username: 'aysel', password: 'StrongPass123', name: 'Aysel' });
    const t = r.body.token as string;
    for (let i = 0; i < 8; i++) await sos(await guest('10.9.9.9'), { hazard: 'fire', location: { lat: 40.37 + i * 0.004, lng: 49.83 } }, '10.9.9.9');
    const mine = await sos(t, { hazard: 'medical', location: NASIMI }, '10.9.9.9');
    expect(mine.status).toBe(201);
    expect(engine.store.sos.get(mine.body.id)!.quarantined).toBeFalsy();
  });

  it('a single panicking citizen is never scored as a bot', () => {
    const g = new SosGuard();
    const v = g.inspect({ citizenId: 'c1', guest: true, issuedAt: Date.now(), ip: '1.1.1.1', hazard: 'fire', location: NASIMI }, []);
    expect(v.quarantine).toBe(false);
    expect(v.score).toBeLessThan(3);
  });
});

describe('Drop 3 · JWT / RBAC on critical dispatcher operations', () => {
  const brigadeId = () => [...engine.store.brigades.values()].find((b) => b.status === 'available')!.id;
  const newSos = async () => (await sos(await guest('10.5.5.5'), { hazard: 'fire', location: NASIMI }, '10.5.5.5')).body.id as string;

  it('no token → 401, citizen / mobility-impaired → 403, dispatcher → 200', async () => {
    const id = await newSos();
    const body = { brigadeId: brigadeId(), sosIds: [id] };
    expect((await request(app).post('/api/dispatch/assign').send(body)).status).toBe(401);
    expect((await request(app).post('/api/dispatch/assign').set(auth(await guest())).send(body)).status).toBe(403);
    const care = (await request(app).post('/api/auth/guest').set('X-Forwarded-For', '10.0.0.7').send({ mobilityImpaired: true })).body.token;
    expect((await request(app).post('/api/dispatch/assign').set(auth(care)).send(body)).status).toBe(403);
    expect((await request(app).post(`/api/dispatch/sos/${id}/assign-nearest`).set(auth(await guest())).send({})).status).toBe(403);
    expect((await request(app).post('/api/dispatch/assign').set(auth(op)).send(body)).status).toBe(200);
  });

  it('rejects forged tokens: alg=none, wrong secret, expired, wrong audience, role escalation', async () => {
    const id = await newSos();
    const body = { brigadeId: brigadeId(), sosIds: [id] };
    const claims = { role: 'dispatcher', name: 'x', guest: false };
    const none = jwt.sign(claims, '', { algorithm: 'none', subject: 'dispatcher', issuer: 'panigo', audience: 'panigo-api' });
    const wrong = jwt.sign(claims, 'attacker-secret', { subject: 'dispatcher', issuer: 'panigo', audience: 'panigo-api' });
    const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, cfg.jwtSecret, { subject: 'dispatcher', issuer: 'panigo', audience: 'panigo-api' });
    const noAud = jwt.sign(claims, cfg.jwtSecret, { subject: 'dispatcher', issuer: 'panigo' });
    const hs512 = jwt.sign(claims, cfg.jwtSecret, { subject: 'dispatcher', issuer: 'panigo', audience: 'panigo-api', algorithm: 'HS512' });
    for (const t of [none, wrong, expired, noAud, hs512]) {
      expect((await request(app).post('/api/dispatch/assign').set(auth(t)).send(body)).status).toBe(401);
    }
    // a guest token re-signed with role=dispatcher by the attacker fails the signature check
    const g = await guest();
    const [h, p, s] = g.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'dispatcher' })).toString('base64url')}.${s}`;
    expect((await request(app).post('/api/dispatch/assign').set(auth(forged)).send(body)).status).toBe(401);
  });

  it('throttles critical operations per operator', async () => {
    setup({ opsPerOperatorPerMin: 3 });
    op = await login('dispatcher', 'dispatcher123');
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).post('/api/dispatch/alerts/nope/dismiss').set(auth(op))).status);
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('publishes guard and latency stats for the dispatcher panel', async () => {
    await sos(await guest(), { hazard: 'fire', location: NASIMI });
    const h = (await request(app).get('/api/health')).body;
    expect(h.guard.accepted).toBe(1);
    expect(h.latency.count).toBeGreaterThan(0);
    expect(h.latency.avgMs).toBeLessThan(300);
  });
});
