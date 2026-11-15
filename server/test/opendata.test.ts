import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { EvacuationPlan, LatLng } from '@shared/types';
import { ODAZ } from '../src/data/opendata';
import { seedPoints, ZONES } from '../src/data/seed';
import { haversine } from '../src/domain/geo';
import { RoutingService } from '../src/routing/routingService';
import type { RawRoute, RoutingProvider } from '../src/routing/types';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { Engine } from '../src/services/engine';
import { UserRepository } from '../src/security/userRepository';

describe('opendata.az integration (official Azerbaijani open data)', () => {
  it('loads the imported datasets with provenance', () => {
    expect(ODAZ).not.toBeNull();
    expect(ODAZ!.sources.length).toBeGreaterThanOrEqual(6);
    expect(ODAZ!.sources.every((s) => s.url.startsWith('https://opendata.az/'))).toBe(true);
  });

  it('zones carry official DSK 2024 population, density and disabled persons', () => {
    const nasimi = ZONES.find((z) => z.id === 'nasimi')!;
    expect(nasimi.population).toBe(ODAZ!.districts['Nəsimi'].population);
    expect(nasimi.densityPerKm2).toBeGreaterThan(10_000);
    expect(nasimi.disabledPersons).toBeGreaterThan(0);
  });

  it('metro shelters = the 27 operating stations with their real exits (no planned/depot stations)', () => {
    const shelters = seedPoints().filter((p) => p.type === 'shelter');
    expect(shelters).toHaveLength(27);
    expect(shelters.every((s) => (s.entrances?.length ?? 0) >= 1)).toBe(true);
    expect(shelters.some((s) => /Y1[456]|deposu|Sentyabr/i.test(s.name))).toBe(false);
  });

  it('initial metro load follows real 2025 ridership (busier station → fuller shelter)', () => {
    const shelters = seedPoints().filter((p) => p.type === 'shelter' && p.ridershipDaily);
    const busiest = shelters.reduce((a, b) => (a.ridershipDaily! > b.ridershipDaily! ? a : b));
    const quietest = shelters.reduce((a, b) => (a.ridershipDaily! < b.ridershipDaily! ? a : b));
    expect(busiest.occupancy / busiest.capacity).toBeGreaterThan(quietest.occupancy / quietest.capacity);
  });

  it('official sport venues are added to the reserve pool', () => {
    expect(seedPoints().some((p) => p.source?.startsWith('opendata.az:') && p.status === 'reserve')).toBe(true);
  });
});

describe('pedestrian routing', () => {
  const fake = (id: 'osrm-foot' | 'osrm', mode: 'foot' | 'vehicle', supports: ('standard' | 'accessible' | 'vehicle')[], distanceM: number): RoutingProvider => ({
    id,
    mode,
    supports,
    closureAware: false,
    route: async (a: LatLng, b: LatLng): Promise<RawRoute[]> => [{ geometry: [a, b], distanceM, durationS: distanceM / (mode === 'foot' ? 1.4 : 10) }],
  });
  const A = { lat: 40.3889, lng: 49.8413 };
  const B = { lat: 40.3797, lng: 49.8486 };

  it('citizens get the pedestrian network, brigades the road network', async () => {
    const svc = new RoutingService([fake('osrm-foot', 'foot', ['standard', 'accessible'], 1423), fake('osrm', 'vehicle', ['vehicle', 'accessible'], 1849)]);
    const walk = await svc.route(A, B, [], 'standard');
    const drive = await svc.route(A, B, [], 'vehicle');
    expect(walk).toMatchObject({ provider: 'osrm-foot', mode: 'foot', distanceM: 1423, degraded: false });
    expect(drive).toMatchObject({ provider: 'osrm', mode: 'vehicle', distanceM: 1849, degraded: false });
    expect(walk.walkS).toBeGreaterThan(drive.durationS);
  });

  it('routes a pedestrian to the NEAREST metro exit, not the station centre', async () => {
    const cfg = loadConfig({ dbFile: null, routingProviders: ['simulated'], simulation: false, rateLimitPerMin: 10_000 });
    const engine = new Engine(cfg);
    const app = createApp(engine, cfg, new UserRepository(null));
    const station = [...engine.store.points.values()].find((p) => p.type === 'shelter' && (p.entrances?.length ?? 0) >= 2)!;
    const exit = station.entrances![1];
    const origin = { lat: exit.lat + 0.002, lng: exit.lng + 0.002 };
    const nearest = station.entrances!.reduce((b, e) => (haversine(origin, e) < haversine(origin, b) ? e : b));
    const token = (await request(app).post('/api/auth/guest')).body.token;
    const plan = (await request(app).post('/api/citizen/plan').set({ Authorization: `Bearer ${token}` }).send({ location: origin, pointId: station.id })).body as EvacuationPlan;
    expect(plan.destination!.id).toBe(station.id);
    expect(plan.entrance).toMatchObject({ lat: nearest.lat, lng: nearest.lng });
    const end = plan.route!.geometry[plan.route!.geometry.length - 1];
    expect(haversine(end, nearest)).toBeLessThan(5);
  });
});
