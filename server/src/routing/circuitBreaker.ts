export type BreakerState = 'closed' | 'open' | 'half_open';

/**
 * Classic circuit breaker: after `threshold` consecutive failures the circuit
 * opens and calls are short-circuited for `cooldownMs` (or the upstream's
 * Retry-After, if longer); then one trial call (half-open) decides whether to
 * close again. While open, the RoutingService serves from the local backup.
 */
export class CircuitBreaker {
  state: BreakerState = 'closed';
  failures = 0;
  lastError?: string;
  forcedDown = false;
  private openedAt = 0;
  private openFor: number;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {
    this.openFor = cooldownMs;
  }

  canRequest(): boolean {
    if (this.forcedDown) return false;
    if (this.state === 'open' && this.now() - this.openedAt >= this.openFor) this.state = 'half_open';
    return this.state !== 'open';
  }

  /** Read-only check (no state transition) — used for status reporting. */
  isUnavailable(): boolean {
    return this.forcedDown || (this.state === 'open' && this.now() - this.openedAt < this.openFor);
  }

  get retryAt(): number | undefined {
    return this.state === 'open' ? this.openedAt + this.openFor : undefined;
  }

  success() {
    this.failures = 0;
    this.state = 'closed';
    this.lastError = undefined;
    this.openFor = this.cooldownMs;
  }

  failure(err: unknown) {
    this.failures++;
    this.lastError = err instanceof Error ? err.message : String(err);
    if (this.state === 'half_open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this.now();
      const retryAfter = (err as { retryAfterMs?: number })?.retryAfterMs;
      this.openFor = Math.max(this.cooldownMs, retryAfter ?? 0);
    }
  }
}
