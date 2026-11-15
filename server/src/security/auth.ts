import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

/**
 * Role-based access control. Roles are data, not code: adding a new role
 * (e.g. "brigade_lead", "volunteer") = one entry here + assigning it to users.
 */
/** JWT hardening (Drop 3): one fixed algorithm (no "alg: none"/RS↔HS confusion), issuer + audience pinned. */
const JWT_ALG = 'HS256' as const;
const JWT_ISS = 'panigo';
const JWT_AUD = 'panigo-api';

export const PERMISSIONS = {
  citizen: ['evac:plan', 'sos:create', 'sos:cancel', 'citizen:status'],
  // Challenge Drop 1 — new role = one line of data
  mobility_impaired: ['evac:plan', 'sos:create', 'sos:cancel', 'citizen:status', 'sos:priority', 'evac:accessible'],
  dispatcher: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage', 'sos:moderate'],
  admin: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage', 'sos:moderate', 'sim:control', 'system:manage', 'audit:read', 'users:manage'],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(perm);
}

export interface Principal {
  sub: string;
  role: Role;
  name: string;
  guest?: boolean;
  /** token issued-at, ms (used by the SOS bot scoring) */
  issuedAt?: number;
}

export function issueToken(p: Principal, secret: string, ttl: string): string {
  return jwt.sign({ role: p.role, name: p.name, guest: p.guest ?? false }, secret, { subject: p.sub, expiresIn: ttl as jwt.SignOptions['expiresIn'], issuer: JWT_ISS, audience: JWT_AUD, algorithm: JWT_ALG });
}

/** Anonymous guest citizen — in an emergency nobody should be forced to sign up before sending SOS. */
export function issueGuestToken(secret: string, mobilityImpaired = false): { token: string; principal: Principal } {
  const principal: Principal = { sub: `guest-${randomUUID()}`, role: mobilityImpaired ? 'mobility_impaired' : 'citizen', name: 'Qonaq', guest: true };
  return { token: issueToken(principal, secret, '7d'), principal };
}

export function verifyToken(token: string, secret: string): Principal | null {
  try {
    const d = jwt.verify(token, secret, { issuer: JWT_ISS, audience: JWT_AUD, algorithms: [JWT_ALG] }) as jwt.JwtPayload;
    if (!d.sub || !d.role || !(d.role in PERMISSIONS)) return null;
    return { sub: d.sub, role: d.role as Role, name: String(d.name ?? ''), guest: !!d.guest, issuedAt: typeof d.iat === 'number' ? d.iat * 1000 : undefined };
  } catch {
    return null;
  }
}
