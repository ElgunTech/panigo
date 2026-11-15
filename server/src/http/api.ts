import { Router } from 'express';
import type { DispatchSnapshot, PublicSnapshot } from '@shared/types';
import type { Engine } from '../services/engine';
import { CLOSURE_PRESETS } from '../data/seed';
import { issueCitizenToken, issueToken, PERMISSIONS, verifyCredentials } from '../security/auth';
import { ah, HttpError, keyedLimiter, requirePermission, validate } from './middleware';
import { closureSchema, dispatchSchema, loginSchema, outageSchema, planSchema, pointPatchSchema, safeSchema, scenarioSchema, sosSchema } from './schemas';

export function apiRouter(engine: Engine): Router {
  const r = Router();
  const { store, config } = engine;

  // ---------- System ----------
  r.get('/health', (_req, res) => res.json({ ok: true, ...engine.systemStatus() }));
  r.get('/meta', (_req, res) => res.json({ roles: PERMISSIONS, closurePresets: CLOSURE_PRESETS }));

  // ---------- Auth ----------
  r.post('/auth/login', validate(loginSchema), (req, res) => {
    const p = verifyCredentials(req.body.username, req.body.password);
    if (!p) throw new HttpError(401, 'INVALID_CREDENTIALS');
    store.log(p.sub, 'auth.login');
    res.json({ token: issueToken(p, config.jwtSecret, config.jwtTtl), user: p });
  });
  r.post('/auth/citizen', (_req, res) => {
    const { token, principal } = issueCitizenToken(config.jwtSecret);
    res.json({ token, user: principal });
  });
  r.get('/auth/me', requirePermission('dashboard:read'), (req, res) => res.json({ user: req.user }));

  // ---------- Public read model ----------
  r.get('/public/snapshot', (_req, res) => {
    const snap: PublicSnapshot = { zones: store.zones, points: [...store.points.values()], closures: store.openClosures() };
    res.json(snap);
  });

  // ---------- Citizen (Module 1) ----------
  r.post(
    '/citizen/plan',
    requirePermission('evac:plan'),
    validate(planSchema),
    ah(async (req, res) => {
      res.json(await engine.evacuation.plan(req.user!.sub, req.body.location, req.body.pointId ? 'manual' : 'initial', [], req.body.pointId));
    }),
  );
  r.get('/citizen/me', requirePermission('citizen:status'), (req, res) => {
    const id = req.user!.sub;
    res.json({
      status: store.citizens.get(id) ?? null,
      plan: engine.evacuation.getPlan(id) ?? null,
      sos: [...store.sos.values()].filter((s) => s.citizenId === id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    });
  });
  r.post(
    '/citizen/sos',
    requirePermission('sos:create'),
    keyedLimiter(config.sosPerCitizenPerMin, (req) => req.user?.sub),
    validate(sosSchema),
    (req, res) => {
      res.status(201).json(engine.createSos(req.user!.sub, req.body.hazard, req.body.location, req.body.note));
    },
  );
  r.post('/citizen/sos/:id/cancel', requirePermission('sos:cancel'), (req, res) => {
    const s = engine.cancelSos(req.user!.sub, req.params.id);
    if (!s) throw new HttpError(404, 'SOS_NOT_FOUND');
    res.json(s);
  });
  r.post('/citizen/status', requirePermission('citizen:status'), validate(safeSchema), (req, res) => {
    res.json(engine.markSafe(req.user!.sub, req.body.safe, req.body.location));
  });

  // ---------- Dispatcher (Module 2) ----------
  r.get('/dispatch/snapshot', requirePermission('dashboard:read'), (_req, res) => {
    const snap: DispatchSnapshot = {
      zones: store.zones,
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
    const status = engine.systemStatus();
    store.publish({ type: 'system.status', data: status }, { kind: 'dispatch' });
    res.json(status);
  });
  r.post('/sim/reset', requirePermission('system:manage'), (req, res) => {
    engine.reset(req.user!.sub);
    res.json({ ok: true });
  });

  return r;
}
