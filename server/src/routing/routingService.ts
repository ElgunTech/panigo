import type { Barrier, FaultMode, LatLng, ProviderHealth, RoadClosure, RouteProfile, RouteResult } from '@shared/types';
import { haversine, pointToSegment, polylineHitsCircle, WALK_SPEED_MS, WHEELCHAIR_SPEED_MS } from '../domain/geo';
import { CircuitBreaker } from './circuitBreaker';
import type { RawRoute, RoutingProvider } from './types';
import type { RouteArchive } from './routeArchive';
import { OsrmProvider } from './osrmProvider';

/** Slightly above the 5 s external timeout — a misbehaving provider can never hang a request. */
const PROVIDER_HARD_TIMEOUT_MS = 6000;
/** After serving an offline answer, report offline mode for at least this long. */
const OFFLINE_STICKY_MS = 15_000;

const isExternal = (p: RoutingProvider) => p.id === 'osrm' || p.id === 'osrm-foot';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`provider exceeded ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

/** Vehicle estimate used when the geometry follows the pedestrian network (crisis traffic). */
const VEHICLE_SPEED_MS = 7;

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

  /** Local backup of real routes (SQLite + seed) — fed by every successful external answer. */
  archive?: RouteArchive;
  /** Called when the routing mode flips online ↔ offline (to notify citizens & dispatch). */
  onModeChange?: (mode: 'online' | 'offline') => void;
  private lastOfflineAt = 0;
  private lastMode: 'online' | 'offline' = 'online';
  stats = { requests: 0, cacheHits: 0, fallbacks: 0, offline: 0, archived: 0 };

  constructor(
    providers: RoutingProvider[],
    breakerFactory: () => CircuitBreaker = () => new CircuitBreaker(),
    private readonly barriers: Barrier[] = [],
  ) {
    this.chain = providers.map((provider) => ({ provider, breaker: breakerFactory() }));
  }

  /**
   * Never throws: every provider failure (HTTP 503, > 5 s timeout, network error,
   * bad payload) is caught, counted by its circuit breaker and the next provider in
   * the chain is tried — ending with a straight-line estimate as the last resort.
   */
  async route(from: LatLng, to: LatLng, closures: RoadClosure[], profile: RouteProfile = 'standard'): Promise<RouteResult> {
    this.stats.requests++;
    const key = `${profile}|${cacheKey(from, to, closures)}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.cacheHits++;
      this.cache.delete(key);
      this.cache.set(key, hit); // LRU refresh
      return hit;
    }

    // Only providers that serve this profile (pedestrian vs road network), in priority order
    const eligible = this.chain.filter(({ provider }) => !provider.supports || provider.supports.includes(profile));
    let result: RouteResult | null = null;
    for (let i = 0; i < eligible.length; i++) {
      const { provider, breaker } = eligible[i];
      if (!breaker.canRequest()) continue;
      try {
        // Hard guard: no provider may hang the request beyond the external timeout + margin
        const routes = await withTimeout(provider.route(from, to, closures, profile), PROVIDER_HARD_TIMEOUT_MS);
        breaker.success();
        if (isExternal(provider) && routes[0] && this.archive) {
          this.archive.save(profile, from, to, routes[0]);
          this.stats.archived++;
        }
        let candidates = provider.closureAware ? routes.slice(0, 1) : routes.filter((r) => !hitsClosure(r, closures));
        // Accessible: among closure-free alternatives pick the one passing the fewest stairs
        if (profile === 'accessible' && candidates.length > 1) {
          candidates = [...candidates].sort((a, b) => this.barriersNear(a.geometry) - this.barriersNear(b.geometry));
        }
        if (!candidates[0]) continue;
        const r = this.toResult(provider, candidates[0], i > 0, profile);
        // Accessible keeps looking (e.g. road network) until a step-free route is found
        if (!result || (profile === 'accessible' && r.barriersNear < result.barriersNear)) result = r;
        if (profile !== 'accessible' || result.barriersNear === 0) break;
      } catch (err) {
        breaker.failure(err);
      }
    }
    if (!result) result = straightLine(from, to, profile);
    if (result.degraded) this.stats.fallbacks++;
    if (result.offline) {
      this.stats.offline++;
      this.lastOfflineAt = Date.now();
    }
    this.checkMode();

    // Only cache ONLINE answers: once the API recovers, citizens get real routes again
    if (!result.offline) {
      this.cache.set(key, result);
      if (this.cache.size > this.cacheMax) this.cache.delete(this.cache.keys().next().value!);
    }
    return result;
  }

  /** online = an external API is usable; offline = every external API is down → local backup. */
  mode(): 'online' | 'offline' {
    const ext = this.chain.filter((c) => isExternal(c.provider));
    if (!ext.length) return 'online';
    const allDown = ext.every((c) => c.breaker.isUnavailable());
    return allDown || Date.now() - this.lastOfflineAt < OFFLINE_STICKY_MS ? 'offline' : 'online';
  }

  checkMode() {
    const m = this.mode();
    if (m !== this.lastMode) {
      this.lastMode = m;
      this.onModeChange?.(m);
    }
  }

  /** Inject a real failure mode into an external provider (Challenge Drop 2 demo). */
  setFault(id: string, fault: FaultMode): boolean {
    const e = this.chain.find((c) => c.provider.id === id);
    if (!e || !(e.provider instanceof OsrmProvider)) return false;
    e.provider.fault = fault;
    if (fault === 'none') {
      e.breaker.success();
      this.lastOfflineAt = 0;
    }
    this.cache.clear();
    this.checkMode();
    return true;
  }

  health(): ProviderHealth[] {
    return this.chain.map(({ provider, breaker }) => ({
      id: provider.id,
      external: isExternal(provider),
      state: breaker.isUnavailable() ? 'open' : breaker.state,
      failures: breaker.failures,
      forcedDown: breaker.forcedDown,
      fault: provider instanceof OsrmProvider ? provider.fault : 'none',
      lastError: breaker.lastError,
      retryAt: breaker.retryAt,
    }));
  }

  /** Chaos switch: simulate an outage of a provider (challenge drop: external API outage). */
  setForcedDown(id: string, down: boolean): boolean {
    const e = this.chain.find((c) => c.provider.id === id);
    if (!e) return false;
    e.breaker.forcedDown = down;
    if (!down) {
      e.breaker.success();
      this.lastOfflineAt = 0;
    }
    this.cache.clear();
    this.checkMode();
    return true;
  }

  invalidate() {
    this.cache.clear();
  }

  /** Stairs / stair-underpasses within 15 m of the route (0 = step-free). */
  barriersNear(line: LatLng[]): number {
    if (!this.barriers.length || line.length < 2) return 0;
    let n = 0;
    for (const b of this.barriers) {
      for (let i = 1; i < line.length; i++) {
        if (pointToSegment(b, line[i - 1], line[i]) <= 15) {
          n++;
          break;
        }
      }
    }
    return n;
  }

  private toResult(p: RoutingProvider, r: RawRoute, degraded: boolean, profile: RouteProfile): RouteResult {
    const foot = p.mode === 'foot';
    // Pedestrian time: the foot router's own estimate (+15 % crowd slowdown) or distance / walking pace
    const walkS =
      profile === 'accessible'
        ? r.distanceM / WHEELCHAIR_SPEED_MS
        : foot && p.id !== 'simulated'
          ? r.durationS * 1.15
          : r.distanceM / WALK_SPEED_MS;
    return {
      provider: p.id,
      geometry: r.geometry,
      distanceM: Math.round(r.distanceM),
      durationS: Math.round(foot ? r.distanceM / VEHICLE_SPEED_MS : r.durationS),
      walkS: Math.round(walkS),
      degraded,
      offline: !isExternal(p),
      profile,
      mode: p.mode,
      barriersNear: profile === 'accessible' ? this.barriersNear(r.geometry) : 0,
    };
  }
}

export function hitsClosure(r: { geometry: LatLng[] }, closures: RoadClosure[]): boolean {
  return closures.some((c) => polylineHitsCircle(r.geometry, c.location, c.radiusM));
}

function straightLine(from: LatLng, to: LatLng, profile: RouteProfile): RouteResult {
  const d = haversine(from, to) * 1.3;
  return {
    provider: 'straight',
    geometry: [from, to],
    distanceM: Math.round(d),
    durationS: Math.round(d / 7),
    walkS: Math.round(d / (profile === 'accessible' ? WHEELCHAIR_SPEED_MS : WALK_SPEED_MS)),
    degraded: true,
    offline: true,
    profile,
    mode: profile === 'vehicle' ? 'vehicle' : 'foot',
    barriersNear: 0,
  };
}

function cacheKey(a: LatLng, b: LatLng, closures: RoadClosure[]): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(a.lat)},${r(a.lng)}>${r(b.lat)},${r(b.lng)}|${closures.map((c) => c.id).sort().join(',')}`;
}
