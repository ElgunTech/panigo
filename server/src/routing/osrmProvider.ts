import type { LatLng } from '@shared/types';
import type { RawRoute, RoutingProvider } from './types';

/** External routing API (OSRM). Unaware of our closures → RoutingService filters its alternatives. */
export class OsrmProvider implements RoutingProvider {
  readonly id = 'osrm' as const;
  readonly closureAware = false;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 2500,
  ) {}

  async route(from: LatLng, to: LatLng): Promise<RawRoute[]> {
    const url = `${this.baseUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
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
