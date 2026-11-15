import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@shared/types';

/**
 * Role-based access control. Roles are data, not code: adding a new role
 * (e.g. "brigade_lead", "volunteer") = one entry here + a user record.
 */
export const PERMISSIONS = {
  citizen: ['evac:plan', 'sos:create', 'sos:cancel', 'citizen:status'],
  dispatcher: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage'],
  admin: ['dashboard:read', 'alert:decide', 'brigade:dispatch', 'closure:manage', 'point:manage', 'sim:control', 'system:manage', 'audit:read'],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(perm);
}

export interface Principal {
  sub: string;
  role: Role;
  name: string;
}

interface UserRecord {
  username: string;
  name: string;
  role: Role;
  salt: string;
  hash: string;
}

function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 32).toString('hex') };
}

/** Demo operator accounts. In production: replace with IdP / DB-backed user repository. */
const users = new Map<string, UserRecord>();
function addUser(username: string, password: string, name: string, role: Role) {
  users.set(username, { username, name, role, ...hashPassword(password) });
}
addUser('dispatcher', process.env.DISPATCHER_PASSWORD ?? 'dispatcher123', 'Növbətçi dispetçer', 'dispatcher');
addUser('admin', process.env.ADMIN_PASSWORD ?? 'admin123', 'FHN Admin', 'admin');

export function verifyCredentials(username: string, password: string): Principal | null {
  const u = users.get(username);
  // constant-time comparison even when the user does not exist
  const { hash } = hashPassword(password, u?.salt ?? 'x'.repeat(32));
  const ok = !!u && timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
  return ok ? { sub: u!.username, role: u!.role, name: u!.name } : null;
}

export function issueToken(p: Principal, secret: string, ttl: string): string {
  return jwt.sign({ role: p.role, name: p.name }, secret, { subject: p.sub, expiresIn: ttl as jwt.SignOptions['expiresIn'], issuer: 'uce' });
}

export function issueCitizenToken(secret: string): { token: string; principal: Principal } {
  const principal: Principal = { sub: `cit-${randomUUID()}`, role: 'citizen', name: 'Vətəndaş' };
  return { token: jwt.sign({ role: 'citizen', name: principal.name }, secret, { subject: principal.sub, expiresIn: '7d', issuer: 'uce' }), principal };
}

export function verifyToken(token: string, secret: string): Principal | null {
  try {
    const d = jwt.verify(token, secret, { issuer: 'uce' }) as jwt.JwtPayload;
    if (!d.sub || !d.role || !(d.role in PERMISSIONS)) return null;
    return { sub: d.sub, role: d.role as Role, name: String(d.name ?? '') };
  } catch {
    return null;
  }
}
