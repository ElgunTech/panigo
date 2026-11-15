export type BreakerState = 'closed' | 'open' | 'half_open';

/**
 * Classic circuit breaker: after `threshold` consecutive failures the circuit
 * opens and calls are short-circuited for `cooldownMs`; then one trial call
 * (half-open) decides whether to close again.
 */
export class CircuitBreaker {
  state: BreakerState = 'closed';
  failures = 0;
  lastError?: string;
  forcedDown = false;
  private openedAt = 0;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  canRequest(): boolean {
    if (this.forcedDown) return false;
    if (this.state === 'open' && this.now() - this.openedAt >= this.cooldownMs) this.state = 'half_open';
    return this.state !== 'open';
  }

  success() {
    this.failures = 0;
    this.state = 'closed';
    this.lastError = undefined;
  }

  failure(err: unknown) {
    this.failures++;
    this.lastError = err instanceof Error ? err.message : String(err);
    if (this.state === 'half_open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
