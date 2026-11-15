import { createRequire } from 'node:module';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Role } from '@shared/types';
import type { Principal } from './auth';

export interface UserRecord {
  username: string;
  name: string;
  role: Role;
  phone?: string;
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
  salt: string;
  hash: string;
}

export type PublicUser = Omit<UserRecord, 'salt' | 'hash'>;

export class UserError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

const SCRYPT_KEYLEN = 32;
function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex') };
}
const DUMMY = hashPassword('timing-equaliser');

export const toPublic = ({ salt: _s, hash: _h, ...u }: UserRecord): PublicUser => u;

/**
 * User accounts: in-memory index + optional SQLite persistence (Node built-in).
 * Self-registration always creates a `citizen`; elevated roles are granted only
 * by an admin (principle of least privilege). Passwords: scrypt + per-user salt,
 * constant-time verification.
 */
export class UserRepository {
  private users = new Map<string, UserRecord>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;

  constructor(dbFile: string | null = null) {
    if (dbFile) {
      try {
        const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
        this.db = new DatabaseSync(dbFile);
        this.db.exec(`CREATE TABLE IF NOT EXISTS users (
          username TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT,
          disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER,
          salt TEXT NOT NULL, hash TEXT NOT NULL)`);
        for (const r of this.db.prepare('SELECT * FROM users').all() as Record<string, unknown>[]) {
          this.users.set(String(r.username), {
            username: String(r.username),
            name: String(r.name),
            role: r.role as Role,
            phone: (r.phone as string) ?? undefined,
            disabled: !!r.disabled,
            createdAt: Number(r.created_at),
            lastLoginAt: r.last_login_at ? Number(r.last_login_at) : undefined,
            salt: String(r.salt),
            hash: String(r.hash),
          });
        }
      } catch (err) {
        console.warn('[users] persistence disabled:', (err as Error).message);
        this.db = null;
      }
    }
    // Bootstrap operator accounts (passwords overridable via env)
    this.ensure('admin', process.env.ADMIN_PASSWORD ?? 'admin123', 'FHN Baş Admin', 'admin');
    this.ensure('dispatcher', process.env.DISPATCHER_PASSWORD ?? 'dispatcher123', 'Növbətçi dispetçer', 'dispatcher');
  }

  private ensure(username: string, password: string, name: string, role: Role) {
    if (!this.users.has(username)) this.save({ username, name, role, disabled: false, createdAt: Date.now(), ...hashPassword(password) });
  }

  private save(u: UserRecord) {
    this.users.set(u.username, u);
    this.db
      ?.prepare(
        `INSERT INTO users (username, name, role, phone, disabled, created_at, last_login_at, salt, hash) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(username) DO UPDATE SET name=excluded.name, role=excluded.role, phone=excluded.phone, disabled=excluded.disabled, last_login_at=excluded.last_login_at, salt=excluded.salt, hash=excluded.hash`,
      )
      .run(u.username, u.name, u.role, u.phone ?? null, u.disabled ? 1 : 0, u.createdAt, u.lastLoginAt ?? null, u.salt, u.hash);
  }

  register(input: { username: string; password: string; name: string; phone?: string }): PublicUser {
    const username = input.username.toLowerCase();
    if (this.users.has(username)) throw new UserError('USERNAME_TAKEN', 409);
    const u: UserRecord = { username, name: input.name, phone: input.phone, role: 'citizen', disabled: false, createdAt: Date.now(), lastLoginAt: Date.now(), ...hashPassword(input.password) };
    this.save(u);
    return toPublic(u);
  }

  verify(usernameRaw: string, password: string): Principal | null {
    const u = this.users.get(usernameRaw.toLowerCase());
    const { hash } = hashPassword(password, u?.salt ?? DUMMY.salt);
    const ok = timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u?.hash ?? DUMMY.hash, 'hex'));
    if (!u || !ok) return null;
    if (u.disabled) throw new UserError('ACCOUNT_DISABLED', 403);
    u.lastLoginAt = Date.now();
    this.save(u);
    return { sub: u.username, role: u.role, name: u.name };
  }

  get(username: string): UserRecord | undefined {
    return this.users.get(username);
  }

  list(): PublicUser[] {
    return [...this.users.values()].map(toPublic).sort((a, b) => b.createdAt - a.createdAt);
  }

  update(username: string, patch: { role?: Role; disabled?: boolean }, actor: string): PublicUser {
    const u = this.users.get(username);
    if (!u) throw new UserError('USER_NOT_FOUND', 404);
    if (username === actor && (patch.disabled || (patch.role && patch.role !== 'admin'))) throw new UserError('CANNOT_DEMOTE_SELF', 409);
    if (patch.role) u.role = patch.role;
    if (patch.disabled !== undefined) u.disabled = patch.disabled;
    this.save(u);
    return toPublic(u);
  }

  close() {
    this.db?.close();
  }
}
