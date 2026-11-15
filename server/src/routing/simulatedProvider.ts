import type { LatLng, RoadClosure } from '@shared/types';
import { polylineLength } from '../domain/geo';
import { RoadNetwork } from '../domain/roadNetwork';
import type { RawRoute, RoutingProvider } from './types';

/** Internal routing engine on the simulated road graph — closure-aware and never offline. */
export class SimulatedProvider implements RoutingProvider {
  readonly id = 'simulated' as const;
  readonly closureAware = true;
  /** average urban driving speed under crisis traffic, m/s */
  private readonly speed = 7;

  constructor(
    private readonly network = new RoadNetwork(),
    private readonly congestion?: (a: LatLng, b: LatLng) => number,
  ) {}

  async route(from: LatLng, to: LatLng, closures: RoadClosure[]): Promise<RawRoute[]> {
    const path = this.network.shortestPath(from, to, closures, this.congestion);
    if (!path) return [];
    const distanceM = polylineLength(path);
    return [{ geometry: path, distanceM, durationS: distanceM / this.speed }];
  }
}
