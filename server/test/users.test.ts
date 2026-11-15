import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';

const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000, authRateLimitPerMin: 1000 });
let app: ReturnType<typeof createApp>;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = async (username: string, password: string) => request(app).post('/api/auth/login').send({ username, password });

beforeEach(() => {
  app = createApp(new Engine(cfg), cfg, new UserRepository(null));
});

describe('registration & unified login', () => {
  it('registers a citizen account and logs in with it', async () => {
    const r = await request(app).post('/api/auth/register').send({ username: 'Aysel.M', password: 'Baku2026!', name: 'Aysel Məmmədova', phone: '+994 50 123 45 67' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ sub: 'aysel.m', role: 'citizen' });
    const l = await login('aysel.m', 'Baku2026!');
    expect(l.status).toBe(200);
    expect(l.body.user.role).toBe('citizen');
  });

  it('never lets self-registration create privileged roles', async () => {
    const r = await request(app).post('/api/auth/register').send({ username: 'hacker', password: 'Passw0rd1', name: 'X Y', role: 'admin' });
    expect(r.status).toBe(201);
    expect(r.body.user.role).toBe('citizen');
  });

  it('rejects duplicates and weak passwords', async () => {
    const body = { username: 'nigar', password: 'Strong123', name: 'Nigar' };
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(201);
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(409);
    expect((await request(app).post('/api/auth/register').send({ ...body, username: 'n2', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ ...body, username: 'n3', password: 'onlyletters' })).status).toBe(400);
  });

  it('routes roles: dispatcher and admin log in through the same endpoint', async () => {
    expect((await login('dispatcher', 'dispatcher123')).body.user.role).toBe('dispatcher');
    expect((await login('admin', 'admin123')).body.user.role).toBe('admin');
  });

  it('issues guest sessions for one-tap SOS without an account', async () => {
    const g = await request(app).post('/api/auth/guest');
    expect(g.body.user.guest).toBe(true);
    const s = await request(app).post('/api/citizen/sos').set(auth(g.body.token)).send({ hazard: 'fire', location: { lat: 40.39, lng: 49.84 } });
    expect(s.status).toBe(201);
  });
});

describe('admin user management', () => {
  it('only admin can list users', async () => {
    const d = (await login('dispatcher', 'dispatcher123')).body.token;
    const a = (await login('admin', 'admin123')).body.token;
    expect((await request(app).get('/api/admin/users').set(auth(d))).status).toBe(403);
    const list = await request(app).get('/api/admin/users').set(auth(a));
    expect(list.status).toBe(200);
    expect(list.body[0]).not.toHaveProperty('hash');
    expect(list.body[0]).not.toHaveProperty('salt');
  });

  it('promotes a citizen to dispatcher — effective immediately with the same token', async () => {
    const c = (await request(app).post('/api/auth/register').send({ username: 'rauf', password: 'Rescue123', name: 'Rauf' })).body.token;
    const a = (await login('admin', 'admin123')).body.token;
    expect((await request(app).get('/api/dispatch/snapshot').set(auth(c))).status).toBe(403);
    await request(app).patch('/api/admin/users/rauf').set(auth(a)).send({ role: 'dispatcher' }).expect(200);
    expect((await request(app).get('/api/dispatch/snapshot').set(auth(c))).status).toBe(200);
  });

  it('blocked accounts lose access and cannot log in', async () => {
    const c = (await request(app).post('/api/auth/register').send({ username: 'leyla', password: 'Secure123', name: 'Leyla' })).body.token;
    const a = (await login('admin', 'admin123')).body.token;
    await request(app).patch('/api/admin/users/leyla').set(auth(a)).send({ disabled: true }).expect(200);
    expect((await request(app).post('/api/citizen/sos').set(auth(c)).send({ hazard: 'fire', location: { lat: 40.39, lng: 49.84 } })).status).toBe(401);
    expect((await login('leyla', 'Secure123')).status).toBe(403);
  });

  it('admin cannot demote or block themselves', async () => {
    const a = (await login('admin', 'admin123')).body.token;
    expect((await request(app).patch('/api/admin/users/admin').set(auth(a)).send({ role: 'citizen' })).status).toBe(409);
  });
});
