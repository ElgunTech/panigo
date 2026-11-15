import type { LatLng, RouteProfile, RouteProviderId } from '@shared/types';
import type { RawRoute, RoutingProvider } from './types';

/**
 * External OSRM routing API. Two instances are used:
 *  - osrm-foot: pedestrian network (pavements, footpaths, crossings) — citizens
 *  - osrm:      road network — rescue brigades / medical transport, step-free fallback
 * Unaware of our closures → RoutingService filters its alternatives.
 */
export class OsrmProvider implements RoutingProvider {
  readonly closureAware = false;

  constructor(
    readonly id: RouteProviderId,
    private readonly baseUrl: string,
    private readonly osrmProfile: 'foot' | 'driving',
    readonly mode: 'foot' | 'vehicle',
    readonly supports: RouteProfile[],
    private readonly timeoutMs = 2500,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RawRoute[]> {
    const url = `${this.baseUrl}/route/v1/${this.osrmProfile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { 'User-Agent': 'panigo-prototype/1.0' } });
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
