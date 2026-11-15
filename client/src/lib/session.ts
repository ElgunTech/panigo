import { useEffect, useState } from 'react';
import type { Role } from '@shared/types';

export interface SessionUser {
  sub: string;
  role: Role;
  name: string;
  guest?: boolean;
}
export interface Session {
  token: string;
  user: SessionUser;
}

const KEY = 'panigo.session';
const listeners = new Set<(s: Session | null) => void>();

export function getSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l(s));
}

export function useSession(): Session | null {
  const [s, set] = useState(getSession);
  useEffect(() => {
    listeners.add(set);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return s;
}

export const isStaff = (r?: Role) => r === 'dispatcher' || r === 'admin';
/** Citizen-side roles (citizen + mobility_impaired) use the citizen app. */
export const isCitizenRole = (r?: Role) => r === 'citizen' || r === 'mobility_impaired';

/** Reads the role claim from a JWT (display only — the server enforces permissions). */
export function tokenRole(token: string | null): Role | undefined {
  try {
    return JSON.parse(atob(token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
  } catch {
    return undefined;
  }
}
export const homeFor = (r?: Role) => (isStaff(r) ? '/dispatch' : '/citizen');
