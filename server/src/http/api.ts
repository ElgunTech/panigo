import { Router } from 'express';
import type { DispatchSnapshot, PublicSnapshot } from '@shared/types';
import type { Engine } from '../services/engine';
import { BARRIERS, CLOSURE_PRESETS, DATASET } from '../data/seed';
import { ODAZ } from '../data/opendata';
import rateLimit from 'express-rate-limit';
import { can, issueGuestToken, issueToken, PERMISSIONS } from '../security/auth';
import { UserRepository } from '../security/userRepository';
import { ah, HttpError, keyedLimiter, requirePermission, validate } from './middleware';
import { faultSchema, registerSchema, userPatchSchema, closureSchema, dispatchSchema, loginSchema, outageSchema, planSchema, pointPatchSchema, safeSchema, scenarioSchema, sosSchema } from './schemas';

export function apiRouter(engine: Engine, users: UserRepository): Router {
  const r = Router();
  const { store, config } = engine;
  // Brute-force protection on credential endpoints (stricter than the global limiter)
  const authLimiter = rateLimit({ windowMs: 60_000, limit: config.authRateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'RATE_LIMITED' } });
  const session = (p: { sub: string; role: string; name: string; guest?: boolean }) => ({ token: issueToken(p as never, config.jwtSecret, config.jwtTtl), user: p });

  // ---------- System ----------
  r.get('/health', (_req, res) => res.json({ ok: true, ...engine.systemStatus() }));
  r.get('/meta', (_req, res) =>
    res.json({
      roles: PERMISSIONS,
      closurePresets: CLOSURE_PRESETS,
      opendata: ODAZ ? { source: ODAZ.source, fetchedAt: ODAZ.fetchedAt, sources: ODAZ.sources, collapseStats: ODAZ.collapseStats } : null,
      dataset: DATASET ? { source: DATASET.source, fetchedAt: DATASET.fetchedAt, points: DATASET.points.length, brigades: DATASET.brigades.length, hospitals: DATASET.hospitals.length } : null,
    }),
  );

  // ---------- Auth ----------
  r.post('/auth/login', authLimiter, validate(loginSchema), (req, res) => {
    const p = users.verify(req.body.username, req.body.password);
    if (!p) {
      store.log(String(req.body.username).slice(0, 64), 'auth.login_failed');
      throw new HttpError(401, 'INVALID_CREDENTIALS');
    }
    store.log(p.sub, 'auth.login');
    res.json(session(p));
  });
  r.post('/auth/register', authLimiter, validate(registerSchema), (req, res) => {
    const u = users.register(req.body, req.body.mobilityImpaired === true);
    store.log(u.username, 'auth.register');
    res.status(201).json(session({ sub: u.username, role: u.role, name: u.name }));
  });
  /** Guest session (no account) — one-tap SOS must never be blocked by sign-up. */
  r.post('/auth/guest', (req, res) => {
    const { token, principal } = issueGuestToken(config.jwtSecret, req.body?.mobilityImpaired === true);
    res.json({ token, user: principal });
  });
  r.post('/auth/citizen', (_req, res) => {
    const { token, principal } = issueGuestToken(config.jwtSecret); // backwards-compatible alias
    res.json({ token, user: principal });
  });
  r.get('/auth/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED');
    const u = req.user.guest ? null : users.get(req.user.sub);
    res.json({ user: req.user, profile: u ? { username: u.username, name: u.name, phone: u.phone, createdAt: u.createdAt } : null });
  });

  // ---------- Admin: user management ----------
  r.get('/admin/users', requirePermission('users:manage'), (_req, res) => res.json(users.list()));
  r.patch('/admin/users/:username', requirePermission('users:manage'), validate(userPatchSchema), (req, res) => {
    const u = users.update(req.params.username, req.body, req.user!.sub);
    store.log(req.user!.sub, 'user.update', { username: u.username, ...req.body });
    res.json(u);
  });

  // ---------- Public read model ----------
  r.get('/public/snapshot', (_req, res) => {
    const snap: PublicSnapshot = { zones: store.zones, points: [...store.points.values()], closures: store.openClosures(), barriers: BARRIERS, dataSource: DATASET?.source, system: engine.systemStatus() };
    res.json(snap);
  });

  // ---------- Citizen (Module 1) ----------
  r.post(
    '/citizen/plan',
    requirePermission('evac:plan'),
    validate(planSchema),
    ah(async (req, res) => {
      const profile = can(req.user!.role, 'evac:accessible') ? 'accessible' : 'standard';
      res.json(await engine.evacuation.plan(req.user!.sub, req.body.location, req.body.pointId ? 'manual' : 'initial', [], req.body.pointId, profile));
    }),
  );
  r.get('/citizen/me', requirePermission('citizen:status'), (req, res) => {
    const id = req.user!.sub;
    res.json({
      status: store.citizens.get(id) ?? null,
      plan: engine.evacuation.getPlan(id) ?? null,
      sos: [...store.sos.values()].filter((s) => s.citizenId === id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
      brigades: engine.brigadesFor(id),
    });
  });
  r.post(
    '/citizen/sos',
    requirePermission('sos:create'),
    keyedLimiter(config.sosPerCitizenPerMin, (req) => req.user?.sub),
    validate(sosSchema),
    (req, res) => {
      // Priority is derived from the authenticated role, never from the request body
      res.status(201).json(engine.createSos(req.user!.sub, req.body.hazard, req.body.location, req.body.note, can(req.user!.role, 'sos:priority')));
    },
  );
  r.post('/citizen/sos/:id/cancel', requirePermission('sos:cancel'), (req, res) => {
    const s = engine.cancelSos(req.user!.sub, req.params.id);
    if (!s) throw new HttpError(404, 'SOS_NOT_FOUND');
    res.json(s);
  });
  r.post('/citizen/sos/:id/arrived', requirePermission('sos:cancel'), (req, res) => {
    const r2 = engine.confirmArrival(req.user!.sub, req.params.id);
    if ('error' in r2) throw new HttpError(r2.error === 'SOS_NOT_FOUND' ? 404 : 409, r2.error!, 'distanceM' in r2 ? { distanceM: r2.distanceM } : undefined);
    res.json(r2);
  });
  r.post('/citizen/status', requirePermission('citizen:status'), validate(safeSchema), (req, res) => {
    res.json(engine.markSafe(req.user!.sub, req.body.safe, req.body.location));
  });

  // ---------- Dispatcher (Module 2) ----------
  r.get('/dispatch/snapshot', requirePermission('dashboard:read'), (_req, res) => {
    const snap: DispatchSnapshot = {
      zones: store.zones,
      hospitals: DATASET?.hospitals ?? [],
      dataSource: DATASET?.source,
      points: [...store.points.values()],
      closures: store.openClosures(),
      sos: [...store.sos.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 1000),
      brigades: [...store.brigades.values()],
      alerts: [...store.alerts.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200),
      citizens: [...store.citizens.values()].slice(-2000),
      system: engine.systemStatus(),
    };
    res.json(snap);
  });
  r.get('/dispatch/metrics', requirePermission('dashboard:read'), (_req, res) => res.json(engine.metrics()));
  r.get('/dispatch/audit', requirePermission('dashboard:read'), (_req, res) => res.json(store.audit.slice(-100).reverse()));

  r.post('/dispatch/alerts/:id/execute', requirePermission('alert:decide'), ah(async (req, res) => res.json(await engine.crisis.execute(req.params.id, req.user!.sub))));
  r.post('/dispatch/alerts/:id/dismiss', requirePermission('alert:decide'), (req, res) => res.json(engine.crisis.dismiss(req.params.id, req.user!.sub)));

  r.post(
    '/dispatch/assign',
    requirePermission('brigade:dispatch'),
    validate(dispatchSchema),
    ah(async (req, res) => res.json(await engine.dispatch.assign(req.body.brigadeId, req.body.sosIds, req.user!.sub))),
  );

  // Nearest SUITABLE brigade (by hazard type, real road ETA) — preview and one-click assign
  r.get('/dispatch/sos/:id/recommendation', requirePermission('brigade:dispatch'), ah(async (req, res) => res.json(await engine.dispatch.recommend(req.params.id))));
  r.post('/dispatch/sos/:id/assign-nearest', requirePermission('brigade:dispatch'), ah(async (req, res) => res.json(await engine.dispatch.assignNearest(req.params.id, req.user!.sub))));

  r.post(
    '/dispatch/closures',
    requirePermission('closure:manage'),
    validate(closureSchema),
    ah(async (req, res) => res.status(201).json(await engine.addClosure(req.body, req.user!.sub))),
  );
  r.delete('/dispatch/closures/:id', requirePermission('closure:manage'), (req, res) => {
    if (!engine.removeClosure(req.params.id, req.user!.sub)) throw new HttpError(404, 'CLOSURE_NOT_FOUND');
    res.status(204).end();
  });

  r.patch(
    '/dispatch/points/:id',
    requirePermission('point:manage'),
    validate(pointPatchSchema),
    ah(async (req, res) => {
      const p = store.points.get(req.params.id);
      if (!p) throw new HttpError(404, 'POINT_NOT_FOUND');
      const occupancy = req.body.occupancyPct !== undefined ? (p.capacity * req.body.occupancyPct) / 100 : req.body.occupancy;
      res.json(await engine.updatePoint(p.id, { occupancy, status: req.body.status }, req.user!.sub));
    }),
  );

  // ---------- Simulation / chaos (admin + dispatcher for demo) ----------
  /**
   * "Simulated road-traffic endpoint": external systems (traffic police,
   * municipal sensors) can push road closures here with the same contract.
   */
  r.post(
    '/sim/traffic/closure',
    requirePermission('closure:manage'),
    validate(closureSchema),
    ah(async (req, res) => res.status(201).json(await engine.addClosure(req.body, `traffic-feed:${req.user!.sub}`))),
  );
  r.post(
    '/sim/scenario',
    requirePermission('point:manage'),
    validate(scenarioSchema),
    ah(async (req, res) => res.json({ started: await engine.runScenario(req.user!.sub, req.body.epicenter) })),
  );
  r.post('/sim/outage', requirePermission('closure:manage'), validate(outageSchema), (req, res) => {
    if (!engine.routing.setForcedDown(req.body.provider, req.body.down)) throw new HttpError(404, 'PROVIDER_NOT_FOUND');
    store.log(req.user!.sub, 'chaos.outage', req.body);
    engine.publishStatus();
    res.json(engine.systemStatus());
  });
  /**
   * Challenge Drop 2 — inject a REAL failure into the external routing API:
   * http503 = upstream answers 503 Service Unavailable, timeout = no answer within 5 s.
   * provider 'external' applies to both OSRM instances.
   */
  r.post('/sim/fault', requirePermission('closure:manage'), validate(faultSchema), (req, res) => {
    const ids = req.body.provider === 'external' ? ['osrm-foot', 'osrm'] : [req.body.provider];
    const ok = ids.map((id: string) => engine.routing.setFault(id, req.body.fault)).some(Boolean);
    if (!ok) throw new HttpError(404, 'PROVIDER_NOT_FOUND');
    store.log(req.user!.sub, 'chaos.fault', req.body);
    engine.publishStatus();
    res.json(engine.systemStatus());
  });
  r.post('/sim/reset', requirePermission('system:manage'), (req, res) => {
    engine.reset(req.user!.sub);
    res.json({ ok: true });
  });

  return r;
}
