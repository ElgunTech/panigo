import type { LatLng, RoadClosure, RouteProfile, RouteProviderId } from '@shared/types';

export interface RawRoute {
  geometry: LatLng[];
  distanceM: number;
  durationS: number;
}

/**
 * Strategy interface — every routing backend (external API, internal graph,
 * future providers such as Google/HERE) implements this. Adding a provider =
 * one class + one entry in ROUTING_PROVIDERS env.
 */
export interface RoutingProvider {
  readonly id: RouteProviderId;
  /** Candidate routes, best first. `profile=accessible` → step-free (wheelchair / medical transport). */
  route(from: LatLng, to: LatLng, closures: RoadClosure[], profile?: RouteProfile): Promise<RawRoute[]>;
  /** Whether the provider natively avoids closures (otherwise the service filters results). */
  readonly closureAware: boolean;
  /** Network the geometry follows: pedestrian paths or roads. */
  readonly mode: 'foot' | 'vehicle';
  /** Profiles this provider may serve (undefined = all). */
  readonly supports?: RouteProfile[];
}
