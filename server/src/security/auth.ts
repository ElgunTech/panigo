import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

/**
 * Role-based access control. Roles are data, not code: adding a new role
 * (e.g. "brigade_lead", "volunteer") = one entry here + assigning it to users.
 */
export const PERMISSIONS = {
  citizen: ['evac:plan', 'sos:create', 'sos:cancel', 'citizen:status'],
  dispatcher: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage'],
  admin: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage', 'sim:control', 'system:manage', 'audit:read', 'users:manage'],
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
}

export function issueToken(p: Principal, secret: string, ttl: string): string {
  return jwt.sign({ role: p.role, name: p.name, guest: p.guest ?? false }, secret, { subject: p.sub, expiresIn: ttl as jwt.SignOptions['expiresIn'], issuer: 'uce' });
}

/** Anonymous guest citizen — in an emergency nobody should be forced to sign up before sending SOS. */
export function issueGuestToken(secret: string): { token: string; principal: Principal } {
  const principal: Principal = { sub: `guest-${randomUUID()}`, role: 'citizen', name: 'Qonaq', guest: true };
  return { token: issueToken(principal, secret, '7d'), principal };
}

export function verifyToken(token: string, secret: string): Principal | null {
  try {
    const d = jwt.verify(token, secret, { issuer: 'uce' }) as jwt.JwtPayload;
    if (!d.sub || !d.role || !(d.role in PERMISSIONS)) return null;
    return { sub: d.sub, role: d.role as Role, name: String(d.name ?? ''), guest: !!d.guest };
  } catch {
    return null;
  }
}
