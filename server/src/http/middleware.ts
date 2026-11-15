import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { can, verifyToken, type Permission, type Principal } from '../security/auth';
import { CrisisError } from '../services/crisisService';
import { UserError, type UserRepository } from '../security/userRepository';
import { DispatchError } from '../services/dispatchService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: Principal;
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: unknown,
  ) {
    super(code);
  }
}

/**
 * Resolves the bearer token. For registered accounts the role is re-read from
 * the user store on every request, so a promotion/demotion or account block by
 * an admin takes effect immediately (no stale privileges inside a valid JWT).
 */
export const authenticate =
  (secret: string, users?: UserRepository): RequestHandler =>
  (req, _res, next) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      const p = verifyToken(h.slice(7), secret);
      if (p && !p.guest && users) {
        const u = users.get(p.sub);
        if (!u || u.disabled) return next();
        p.role = u.role;
        p.name = u.name;
      }
      if (p) req.user = p;
    }
    next();
  };

export const requirePermission =
  (perm: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'UNAUTHENTICATED'));
    if (!can(req.user.role, perm)) return next(new HttpError(403, 'FORBIDDEN', { required: perm }));
    next();
  };

/** Validates and replaces req.body with the parsed (typed, stripped) value. */
export const validate =
  (schema: ZodSchema): RequestHandler =>
  (req, _res, next) => {
    const r = schema.safeParse(req.body);
    if (!r.success) return next(new HttpError(400, 'VALIDATION_ERROR', r.error.flatten()));
    req.body = r.data;
    next();
  };

/** Wraps async handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res)).catch(next);

/** Per-key sliding counter (used for per-citizen SOS throttling — independent of IP). */
export function keyedLimiter(maxPerMin: number, key: (req: Request) => string | undefined): RequestHandler {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of hits) {
      const f = v.filter((t) => t > cutoff);
      if (f.length) hits.set(k, f);
      else hits.delete(k);
    }
  }, 60_000).unref();
  return (req, _res, next) => {
    const k = key(req);
    if (!k) return next();
    const now = Date.now();
    const arr = (hits.get(k) ?? []).filter((t) => t > now - 60_000);
    if (arr.length >= maxPerMin) return next(new HttpError(429, 'TOO_MANY_SOS'));
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, details: err.details });
  if (err instanceof UserError) return res.status(err.status).json({ error: err.code });
  if (err instanceof CrisisError) return res.status(err.status).json({ error: err.code });
  if (err instanceof DispatchError) return res.status(err.code === 'SOS_NOT_FOUND' ? 404 : 409).json({ error: err.code });
  if (err instanceof ZodError) return res.status(400).json({ error: 'VALIDATION_ERROR', details: err.flatten() });
  if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
}
