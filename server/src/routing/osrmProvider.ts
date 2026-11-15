import type { FaultMode, LatLng, RouteProfile, RouteProviderId } from '@shared/types';
import type { RawRoute, RoutingProvider } from './types';

/** Upstream answered but is unavailable (e.g. HTTP 503). Carries Retry-After for the breaker. */
export class UpstreamUnavailableError extends Error {
  constructor(
    public status: number,
    public retryAfterMs?: number,
  ) {
    super(`HTTP ${status} Service Unavailable`);
  }
}

export class UpstreamTimeoutError extends Error {
  constructor(ms: number) {
    super(`Timeout: no response within ${ms / 1000} s`);
  }
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}

/**
 * External OSRM routing API. Two instances are used:
 *  - osrm-foot: pedestrian network (pavements, footpaths, crossings) — citizens
 *  - osrm:      road network — rescue brigades / medical transport, step-free fallback
 * Failure modes are normalised (503 → UpstreamUnavailableError, > timeout → UpstreamTimeoutError)
 * so the circuit breaker can react; `fault` lets operators inject the Drop-2 outage on demand.
 */
export class OsrmProvider implements RoutingProvider {
  readonly closureAware = false;
  /** Chaos / fault injection (Challenge Drop 2 demo): simulates the real upstream failure modes. */
  fault: FaultMode = 'none';

  constructor(
    readonly id: RouteProviderId,
    private readonly baseUrl: string,
    private readonly osrmProfile: 'foot' | 'driving',
    readonly mode: 'foot' | 'vehicle',
    readonly supports: RouteProfile[],
    private readonly timeoutMs = 5000,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RawRoute[]> {
    if (this.fault === 'http503') throw new UpstreamUnavailableError(503, 30_000);
    if (this.fault === 'timeout') {
      // behave exactly like a hung upstream: nothing comes back until our timeout fires
      await new Promise((r) => setTimeout(r, this.timeoutMs));
      throw new UpstreamTimeoutError(this.timeoutMs);
    }
    const url = `${this.baseUrl}/route/v1/${this.osrmProfile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=3`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { 'User-Agent': 'panigo-prototype/1.0' } });
    } catch (e) {
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw new UpstreamTimeoutError(this.timeoutMs);
      throw e;
    }
    if (res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) {
      throw new UpstreamUnavailableError(res.status, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const body = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    if (body.code !== 'Ok' || !body.routes?.length) throw new Error(`OSRM ${body.code}`);
    return body.routes.map((r) => ({
      geometry: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceM: r.distance,
      durationS: r.duration,
    }));
  }
}
