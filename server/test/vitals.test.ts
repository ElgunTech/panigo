import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';

/** Phone-camera pulse (PPG) → attached to the citizen's SOS for the dispatcher. */
const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000 });
const P = { lat: 40.3889, lng: 49.8413 };
let engine: Engine;
let app: ReturnType<typeof createApp>;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  engine = new Engine(cfg);
  app = createApp(engine, cfg, new UserRepository(null));
});

describe('camera pulse (vitals)', () => {
  it('attaches the measurement to the open SOS and flags abnormal values without changing priority', async () => {
    const t = (await request(app).post('/api/auth/guest')).body.token;
    const s = (await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'collapse', location: P })).body;
    const r = await request(app).post('/api/citizen/vitals').set(auth(t)).send({ bpm: 134, quality: 0.71, method: 'camera_ppg' });
    expect(r.status).toBe(201);
    expect(r.body.attachedSosIds).toEqual([s.id]);
    const sos = engine.store.sos.get(s.id)!;
    expect(sos.vitals).toMatchObject({ bpm: 134, abnormal: true, method: 'camera_ppg' });
    expect(sos.priority).toBe(2); // estimate → informs, never auto-escalates
    const op = (await request(app).post('/api/auth/login').send({ username: 'dispatcher', password: 'dispatcher123' })).body.token;
    const snap = (await request(app).get('/api/dispatch/snapshot').set(auth(op))).body;
    expect(snap.sos.find((x: { id: string }) => x.id === s.id).vitals.bpm).toBe(134);
  });

  it('a pulse measured before the SOS travels with the new SOS', async () => {
    const t = (await request(app).post('/api/auth/guest')).body.token;
    await request(app).post('/api/citizen/vitals').set(auth(t)).send({ bpm: 82, quality: 0.8, method: 'camera_ppg' }).expect(201);
    const s = (await request(app).post('/api/citizen/sos').set(auth(t)).send({ hazard: 'medical', location: P })).body;
    expect(s.vitals).toMatchObject({ bpm: 82, abnormal: false });
  });

  it('validates input and requires a citizen session', async () => {
    const t = (await request(app).post('/api/auth/guest')).body.token;
    expect((await request(app).post('/api/citizen/vitals').set(auth(t)).send({ bpm: 400, quality: 0.8, method: 'camera_ppg' })).status).toBe(400);
    expect((await request(app).post('/api/citizen/vitals').set(auth(t)).send({ bpm: 80, quality: 0.8, method: 'cuff' })).status).toBe(400);
    expect((await request(app).post('/api/citizen/vitals').send({ bpm: 80, quality: 0.8, method: 'camera_ppg' })).status).toBe(401);
  });
});
