import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { BrigadeType, Hazard } from '@shared/types';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';
import { haversine } from '../src/domain/geo';

/** Dispatcher one-click "assign nearest suitable unit". */
const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000 });
const P = { lat: 40.3889, lng: 49.8413 };
let engine: Engine;
let app: ReturnType<typeof createApp>;
let op: string;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function sos(hazard: Hazard, care = false) {
  const t = (await request(app).post('/api/auth/guest').send({ mobilityImpaired: care })).body.token;
  return (await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard, location: P })).body as { id: string };
}

beforeEach(async () => {
  engine = new Engine(cfg);
  app = createApp(engine, cfg, new UserRepository(null));
  op = (await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token;
});

describe('nearest suitable brigade', () => {
  const cases: [Hazard, BrigadeType][] = [
    ['medical', 'medical'],
    ['fire', 'fire'],
    ['collapse', 'rescue'],
    ['flood', 'rescue'],
  ];
  for (const [hazard, type] of cases) {
    it(`${hazard} → nearest ${type} unit`, async () => {
      const s = await sos(hazard);
      const rec = (await request(app).get(`/api/dispatch/sos/${s.id}/recommendation`).set(auth(op))).body;
      expect(rec.brigadeType).toBe(type);
      expect(rec.matchedType).toBe(true);
      // it is (one of) the closest units of that type
      const free = [...engine.store.brigades.values()].filter((b) => b.type === type).sort((a, b) => haversine(a.location, P) - haversine(b.location, P));
      expect(free.slice(0, 3).map((b) => b.id)).toContain(rec.brigadeId);
    });
  }

  it('Priority #1 (mobility-impaired) always gets a medical unit', async () => {
    const s = await sos('fire', true);
    const rec = (await request(app).get(`/api/dispatch/sos/${s.id}/recommendation`).set(auth(op))).body;
    expect(rec.brigadeType).toBe('medical');
  });

  it('falls back to the nearest other unit when no unit of that type is free', async () => {
    for (const b of engine.store.brigades.values()) if (b.type === 'fire') b.status = 'en_route';
    const s = await sos('fire');
    const rec = (await request(app).get(`/api/dispatch/sos/${s.id}/recommendation`).set(auth(op))).body;
    expect(rec.matchedType).toBe(false);
    expect(rec.brigadeType).not.toBe('fire');
  });

  it('one click assigns it and the unit drives to the SOS point', async () => {
    const s = await sos('medical');
    const r = await request(app).post(`/api/dispatch/sos/${s.id}/assign-nearest`).set(auth(op));
    expect(r.status).toBe(200);
    expect(r.body.brigade.status).toBe('en_route');
    expect(r.body.brigade.type).toBe('medical');
    expect(engine.store.sos.get(s.id)!.brigadeId).toBe(r.body.brigade.id);
  });

  it('409 when no brigade at all is free; citizens cannot use it', async () => {
    const s = await sos('medical');
    const citizen = (await request(app).post('/api/auth/guest')).body.token;
    expect((await request(app).post(`/api/dispatch/sos/${s.id}/assign-nearest`).set(auth(citizen))).status).toBe(403);
    for (const b of engine.store.brigades.values()) b.status = 'on_scene';
    const r = await request(app).post(`/api/dispatch/sos/${s.id}/assign-nearest`).set(auth(op));
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('NO_FREE_BRIGADE');
  });
});
