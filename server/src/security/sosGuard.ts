import type { Hazard, LatLng, SosSignal } from '@shared/types';
import { haversine } from '../domain/geo';

/**
 * Challenge Drop 3 — SOS flood / spam protection (beyond plain rate limiting).
 *
 *  1. Duplicate filter: the same citizen re-sending the same hazard within 2 min and
 *     150 m returns the existing SOS instead of creating a new one (idempotent).
 *  2. Bot scoring: weak signals are combined into a score; ≥ 3 → QUARANTINE.
 *       +1  brand-new anonymous session (token issued < 20 s ago)
 *       +2  source IP burst (> 5 SOS from the same IP within 60 s)
 *       +2  coordinate fingerprint: ≥ 3 different citizens sent the exact same
 *           coordinates within 60 s (scripted bots; real phones never agree to 1e-5°)
 *       +1  extreme global surge (> 200 SOS/min) for a new anonymous session
 *       −2  registered (non-guest) account
 *     A single panicking citizen scores ≤ 1 and is never quarantined.
 *  3. Quarantined SOS are stored (nothing is lost) but do not reach the dispatcher
 *     feed and never trigger crisis alerts until an operator releases them.
 */

export interface GuardInput {
  citizenId: string;
  guest: boolean;
  /** token "issued at" (ms) */
  issuedAt?: number;
  ip: string;
  hazard: Hazard;
  location: LatLng;
  idempotencyKey?: string;
}

export interface GuardVerdict {
  duplicateOf?: string;
  quarantine: boolean;
  score: number;
  reasons: string[];
}

export interface GuardStats {
  accepted: number;
  duplicates: number;
  quarantined: number;
  rateLimited: number;
  released: number;
  rejected: number;
  /** SOS requests in the last 60 s (all outcomes) */
  perMinute: number;
  underAttack: boolean;
}

const WINDOW_MS = 60_000;
const DUP_WINDOW_MS = 2 * 60_000;
const DUP_RADIUS_M = 150;
export const QUARANTINE_SCORE = 3;
const SURGE_PER_MIN = 200;

export class SosGuard {
  private ipHits = new Map<string, number[]>();
  private fingerprints = new Map<string, { at: number; citizens: Set<string> }>();
  private idem = new Map<string, { id: string; at: number }>();
  private recent: number[] = [];
  stats: Omit<GuardStats, 'perMinute' | 'underAttack'> = { accepted: 0, duplicates: 0, quarantined: 0, rateLimited: 0, released: 0, rejected: 0 };

  constructor(private readonly now: () => number = Date.now) {}

  /** Decide before the SOS is created. `openSos` = this citizen's recent open signals. */
  inspect(input: GuardInput, openSos: SosSignal[]): GuardVerdict {
    const now = this.now();
    this.prune(now);
    this.recent.push(now);

    // 0) Idempotency-Key: a retried request (network flake / double tap) never duplicates
    if (input.idempotencyKey) {
      const hit = this.idem.get(`${input.citizenId}|${input.idempotencyKey}`);
      if (hit) {
        this.stats.duplicates++;
        return { duplicateOf: hit.id, quarantine: false, score: 0, reasons: ['idempotency_key'] };
      }
    }

    // 1) duplicate of the citizen's own open SOS
    const dup = openSos.find((s) => s.hazard === input.hazard && now - s.createdAt <= DUP_WINDOW_MS && haversine(s.location, input.location) <= DUP_RADIUS_M);
    if (dup) {
      this.stats.duplicates++;
      return { duplicateOf: dup.id, quarantine: false, score: 0, reasons: ['duplicate'] };
    }

    // 2) bot scoring
    let score = 0;
    const reasons: string[] = [];
    if (input.guest && input.issuedAt && now - input.issuedAt < 20_000) {
      score += 1;
      reasons.push('new_session');
    }
    const hits = (this.ipHits.get(input.ip) ?? []).filter((t) => t >= now - WINDOW_MS);
    hits.push(now);
    this.ipHits.set(input.ip, hits);
    if (hits.length > 5) {
      score += 2;
      reasons.push('ip_burst');
    }
    const fp = `${input.location.lat.toFixed(5)},${input.location.lng.toFixed(5)}`;
    const f = this.fingerprints.get(fp) ?? { at: now, citizens: new Set<string>() };
    f.citizens.add(input.citizenId);
    f.at = now;
    this.fingerprints.set(fp, f);
    if (f.citizens.size >= 3) {
      score += 2;
      reasons.push('coordinate_fingerprint');
    }
    if (this.recent.length > SURGE_PER_MIN && input.guest && input.issuedAt && now - input.issuedAt < 60_000) {
      score += 1;
      reasons.push('global_surge');
    }
    if (!input.guest) {
      score -= 2;
      reasons.push('registered_account');
    }
    const quarantine = score >= QUARANTINE_SCORE;
    if (quarantine) this.stats.quarantined++;
    else this.stats.accepted++;
    return { quarantine, score, reasons };
  }

  remember(citizenId: string, idempotencyKey: string | undefined, sosId: string) {
    if (idempotencyKey) this.idem.set(`${citizenId}|${idempotencyKey}`, { id: sosId, at: this.now() });
  }

  noteRateLimited() {
    this.stats.rateLimited++;
    this.recent.push(this.now());
  }

  snapshot(): GuardStats {
    const now = this.now();
    this.prune(now);
    return { ...this.stats, perMinute: this.recent.length, underAttack: this.recent.length > SURGE_PER_MIN || this.stats.quarantined + this.stats.rateLimited > 50 };
  }

  private calls = 0;

  /** Sliding-window housekeeping: O(1) per call, full sweep every 256 calls (bounded memory under flood). */
  private prune(now: number) {
    const cut = now - WINDOW_MS;
    while (this.recent.length && this.recent[0] < cut) this.recent.shift();
    if (++this.calls % 256 !== 0) return;
    for (const [ip, arr] of this.ipHits) {
      const f = arr.filter((t) => t >= cut);
      if (f.length) this.ipHits.set(ip, f);
      else this.ipHits.delete(ip);
    }
    for (const [k, v] of this.fingerprints) if (v.at < cut) this.fingerprints.delete(k);
    for (const [k, v] of this.idem) if (v.at < now - DUP_WINDOW_MS) this.idem.delete(k);
  }

  reset() {
    this.ipHits.clear();
    this.fingerprints.clear();
    this.idem.clear();
    this.recent = [];
    this.stats = { accepted: 0, duplicates: 0, quarantined: 0, rateLimited: 0, released: 0, rejected: 0 };
  }
}
