import { getSession, isCitizenRole, tokenRole } from './session';
/** Thin typed fetch wrapper. Token is per-app ("citizen" | "operator") and kept in localStorage. */
export type TokenKind = 'citizen' | 'operator';

const KEY = (k: TokenKind) => `panigo.token.${k}`;

export function getToken(kind: TokenKind): string | null {
  try {
    return localStorage.getItem(KEY(kind));
  } catch {
    return null;
  }
}

export function setToken(kind: TokenKind, token: string | null) {
  try {
    if (token) localStorage.setItem(KEY(kind), token);
    else localStorage.removeItem(KEY(kind));
  } catch {
    /* storage unavailable — session-only */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'HTTP_ERROR');
  return data as T;
}

/**
 * Token for the citizen app: the signed-in account if there is one, otherwise
 * an anonymous guest session (one-click SOS must never require sign-up).
 */
export async function ensureCitizenToken(care?: boolean): Promise<string> {
  const s = getSession();
  if (s && isCitizenRole(s.user.role)) return s.token;
  const existing = getToken('citizen');
  // Reuse the guest identity (and its SOS history) unless a *different* care mode is requested —
  // reloading /citizen?care=1 must not create a new anonymous citizen.
  const sameMode = care === undefined || (tokenRole(existing) === 'mobility_impaired') === care;
  if (existing && sameMode) {
    try {
      await api('/citizen/me', { token: existing });
      return existing;
    } catch {
      /* expired/invalid → issue a new one */
    }
  }
  const { token } = await api<{ token: string }>('/auth/guest', { body: { mobilityImpaired: !!care } });
  setToken('citizen', token);
  return token;
}
