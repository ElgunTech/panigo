import type { LatLng, ProviderHealth, RoadClosure, RouteResult } from '@shared/types';
import { haversine, polylineHitsCircle, WALK_SPEED_MS } from '../domain/geo';
import { CircuitBreaker } from './circuitBreaker';
import type { RawRoute, RoutingProvider } from './types';

interface Entry {
  provider: RoutingProvider;
  breaker: CircuitBreaker;
}

/**
 * Provider chain with circuit breakers, closure filtering and an LRU cache.
 * Order = priority. If every provider fails, a straight-line estimate is
 * returned so the citizen always gets guidance (graceful degradation).
 */
export class RoutingService {
  private readonly chain: Entry[];
  private readonly cache = new Map<string, RouteResult>();
  private readonly cacheMax = 2000;
  stats = { requests: 0, cacheHits: 0, fallbacks: 0 };

  constructor(providers: RoutingProvider[], breakerFactory: () => CircuitBreaker = () => new CircuitBreaker()) {
    this.chain = providers.map((provider) => ({ provider, breaker: breakerFactory() }));
  }

  async route(from: LatLng, to: LatLng, closures: RoadClosure[]): Promise<RouteResult> {
    this.stats.requests++;
    const key = cacheKey(from, to, closures);
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.cacheHits++;
      this.cache.delete(key);
      this.cache.set(key, hit); // LRU refresh
      return hit;
    }

    let result: RouteResult | null = null;
    for (let i = 0; i < this.chain.length && !result; i++) {
      const { provider, breaker } = this.chain[i];
      if (!breaker.canRequest()) continue;
      try {
        const routes = await provider.route(from, to, closures);
        breaker.success();
        const clean = provider.closureAware ? routes[0] : routes.find((r) => !hitsClosure(r, closures));
        if (clean) result = toResult(provider.id, clean, i > 0);
      } catch (err) {
        breaker.failure(err);
      }
    }
    if (!result) result = straightLine(from, to);
    if (result.degraded) this.stats.fallbacks++;

    this.cache.set(key, result);
    if (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  health(): ProviderHealth[] {
    return this.chain.map(({ provider, breaker }) => ({
      id: provider.id,
      state: breaker.state,
      failures: breaker.failures,
      forcedDown: breaker.forcedDown,
      lastError: breaker.lastError,
    }));
  }

  /** Chaos switch: simulate an outage of a provider (challenge drop: external API outage). */
  setForcedDown(id: string, down: boolean): boolean {
    const e = this.chain.find((c) => c.provider.id === id);
    if (!e) return false;
    e.breaker.forcedDown = down;
    if (!down) e.breaker.success();
    this.cache.clear();
    return true;
  }

  invalidate() {
    this.cache.clear();
  }
}

export function hitsClosure(r: { geometry: LatLng[] }, closures: RoadClosure[]): boolean {
  return closures.some((c) => polylineHitsCircle(r.geometry, c.location, c.radiusM));
}

function toResult(provider: RouteResult['provider'], r: RawRoute, degraded: boolean): RouteResult {
  return {
    provider,
    geometry: r.geometry,
    distanceM: Math.round(r.distanceM),
    durationS: Math.round(r.durationS),
    walkS: Math.round(r.distanceM / WALK_SPEED_MS),
    degraded,
  };
}

function straightLine(from: LatLng, to: LatLng): RouteResult {
  const d = haversine(from, to) * 1.3;
  return {
    provider: 'straight',
    geometry: [from, to],
    distanceM: Math.round(d),
    durationS: Math.round(d / 7),
    walkS: Math.round(d / WALK_SPEED_MS),
    degraded: true,
  };
}

function cacheKey(a: LatLng, b: LatLng, closures: RoadClosure[]): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(a.lat)},${r(a.lng)}>${r(b.lat)},${r(b.lng)}|${closures.map((c) => c.id).sort().join(',')}`;
}
