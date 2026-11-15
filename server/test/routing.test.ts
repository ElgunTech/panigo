import { describe, expect, it, vi } from 'vitest';
import type { LatLng, RoadClosure } from '@shared/types';
import { haversine, polylineHitsCircle } from '../src/domain/geo';
import { RoadNetwork } from '../src/domain/roadNetwork';
import { rankPoints } from '../src/domain/recommendation';
import { CircuitBreaker } from '../src/routing/circuitBreaker';
import { RoutingService } from '../src/routing/routingService';
import { SimulatedProvider } from '../src/routing/simulatedProvider';
import type { RoutingProvider } from '../src/routing/types';
import { seedPoints } from '../src/data/seed';

const A: LatLng = { lat: 40.3889, lng: 49.8413 };
const B: LatLng = { lat: 40.4004, lng: 49.8513 };
const closure = (location: LatLng, radiusM = 300): RoadClosure => ({ id: `c${location.lat}`, name: 'x', reason: 'x', location, radiusM, createdAt: 0 });

describe('geo', () => {
  it('haversine ≈ 1.11 km per 0.01° latitude', () => {
    expect(haversine({ lat: 40, lng: 49 }, { lat: 40.01, lng: 49 })).toBeGreaterThan(1100);
    expect(haversine({ lat: 40, lng: 49 }, { lat: 40.01, lng: 49 })).toBeLessThan(1120);
  });
  it('detects a polyline crossing a circle', () => {
    expect(polylineHitsCircle([A, B], { lat: (A.lat + B.lat) / 2, lng: (A.lng + B.lng) / 2 }, 50)).toBe(true);
    expect(polylineHitsCircle([A, B], { lat: 40.43, lng: 49.95 }, 200)).toBe(false);
  });
});

describe('RoadNetwork (internal routing engine)', () => {
  const net = new RoadNetwork();
  it('finds a path', () => {
    const p = net.shortestPath(A, B);
    expect(p).not.toBeNull();
    expect(p![0]).toEqual(A);
    expect(p![p!.length - 1]).toEqual(B);
  });
  it('avoids a closed road', () => {
    const direct = net.shortestPath(A, B)!;
    const mid = direct[Math.floor(direct.length / 2)];
    const c = closure(mid, 250);
    const detour = net.shortestPath(A, B, [c])!;
    expect(detour).not.toBeNull();
    // interior of the detour (excluding user-supplied endpoints) must not touch the closure
    expect(polylineHitsCircle(detour.slice(1, -1), c.location, c.radiusM)).toBe(false);
  });
});

describe('RoutingService (provider chain + circuit breaker)', () => {
  const failing = (): RoutingProvider & { calls: number } => {
    const p = {
      id: 'osrm' as const,
      closureAware: false,
      calls: 0,
      route: vi.fn(async () => {
        p.calls++;
        throw new Error('timeout');
      }),
    };
    return p;
  };

  it('falls back to the internal graph when the external API fails', async () => {
    const svc = new RoutingService([failing(), new SimulatedProvider()]);
    const r = await svc.route(A, B, []);
    expect(r.provider).toBe('simulated');
    expect(r.degraded).toBe(true);
  });

  it('opens the circuit after 3 failures and stops calling the external API', async () => {
    const ext = failing();
    const svc = new RoutingService([ext, new SimulatedProvider()], () => new CircuitBreaker(3, 60_000));
    for (let i = 0; i < 5; i++) await svc.route({ lat: A.lat + i * 0.001, lng: A.lng }, B, []);
    expect(ext.calls).toBe(3);
    expect(svc.health()[0].state).toBe('open');
  });

  it('rejects external routes that cross a closure and uses a clean one', async () => {
    const c = closure({ lat: 40.3945, lng: 49.8463 }, 200);
    const ext: RoutingProvider = {
      id: 'osrm',
      closureAware: false,
      route: async () => [
        { geometry: [A, { lat: 40.3945, lng: 49.8463 }, B], distanceM: 1500, durationS: 200 },
        { geometry: [A, { lat: 40.3889, lng: 49.8513 }, B], distanceM: 1900, durationS: 260 },
      ],
    };
    const r = await new RoutingService([ext]).route(A, B, [c]);
    expect(r.provider).toBe('osrm');
    expect(r.distanceM).toBe(1900);
  });

  it('degrades to a straight-line estimate if every provider is down', async () => {
    const svc = new RoutingService([failing()]);
    const r = await svc.route(A, B, []);
    expect(r.provider).toBe('straight');
    expect(r.walkS).toBeGreaterThan(0);
  });

  it('chaos switch forces a provider down', async () => {
    const svc = new RoutingService([new SimulatedProvider()]);
    svc.setForcedDown('simulated', true);
    expect((await svc.route(A, B, [])).provider).toBe('straight');
    svc.setForcedDown('simulated', false);
    expect((await svc.route(A, B, [])).provider).toBe('simulated');
  });

  it('caches identical requests', async () => {
    const sim = new SimulatedProvider();
    const spy = vi.spyOn(sim, 'route');
    const svc = new RoutingService([sim]);
    await svc.route(A, B, []);
    await svc.route(A, B, []);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(svc.stats.cacheHits).toBe(1);
  });
});

describe('rankPoints', () => {
  it('never recommends ≥90% points ahead of available ones and excludes reserve points', () => {
    const pts = seedPoints();
    const near = pts.find((p) => p.id === 'p-28may')!;
    near.occupancy = near.capacity * 0.95;
    const ranked = rankPoints(near.location, pts);
    expect(ranked[0].point.id).not.toBe('p-28may');
    expect(ranked.find((o) => o.point.id === 'p-28may')!.full).toBe(true);
    expect(ranked.some((o) => o.point.status === 'reserve')).toBe(false);
  });
});
