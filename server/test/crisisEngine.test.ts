import { describe, expect, it } from 'vitest';
import type { AssemblyPoint, Brigade, SosSignal } from '@shared/types';
import { detectSosCluster, isOverCapacity, pickBrigade, pickReservePoint } from '../src/domain/crisisEngine';

const NOW = 1_000_000_000;
let n = 0;
const sos = (citizenId: string, lat: number, lng: number, zoneId = 'nasimi', agoMs = 0, status: SosSignal['status'] = 'new'): SosSignal => ({
  id: `s${++n}`,
  citizenId,
  hazard: 'collapse',
  location: { lat, lng },
  zoneId,
  status,
  createdAt: NOW - agoMs,
  updatedAt: NOW - agoMs,
});

describe('detectSosCluster (critical crisis algorithm)', () => {
  it('does NOT trigger with 3 distinct citizens', () => {
    const list = [sos('a', 40.39, 49.84), sos('b', 40.3901, 49.8401), sos('c', 40.3902, 49.8402)];
    expect(detectSosCluster(list[2], list, NOW)).toBeNull();
  });

  it('triggers with 4 distinct citizens within 500 m', () => {
    const list = [sos('a', 40.39, 49.84, 'z1'), sos('b', 40.391, 49.841, 'z2'), sos('c', 40.392, 49.840, 'z3'), sos('d', 40.3905, 49.8395, 'z4')];
    const c = detectSosCluster(list[3], list, NOW);
    expect(c).not.toBeNull();
    expect(c!.distinctCitizens).toBe(4);
    expect(c!.sosIds).toHaveLength(4);
  });

  it('triggers for the same zone even if further than 500 m apart', () => {
    const list = [sos('a', 40.38, 49.83), sos('b', 40.39, 49.85), sos('c', 40.385, 49.845), sos('d', 40.395, 49.835)];
    expect(detectSosCluster(list[3], list, NOW)).not.toBeNull();
  });

  it('counts DISTINCT citizens — one person spamming SOS is not a crisis', () => {
    const list = [sos('a', 40.39, 49.84), sos('a', 40.39, 49.84), sos('a', 40.39, 49.84), sos('a', 40.39, 49.84), sos('b', 40.39, 49.84)];
    expect(detectSosCluster(list[4], list, NOW)).toBeNull();
  });

  it('ignores signals outside the 5-minute window', () => {
    const list = [sos('a', 40.39, 49.84, 'nasimi', 6 * 60_000), sos('b', 40.39, 49.84), sos('c', 40.39, 49.84), sos('d', 40.39, 49.84)];
    expect(detectSosCluster(list[3], list, NOW)).toBeNull();
  });

  it('ignores far signals from other zones', () => {
    const list = [sos('a', 40.43, 49.93, 'sabunchu'), sos('b', 40.39, 49.84), sos('c', 40.39, 49.84), sos('d', 40.39, 49.84)];
    expect(detectSosCluster(list[3], list, NOW)).toBeNull();
  });

  it('ignores signals already answered by a brigade (no re-trigger after decision)', () => {
    const list = [sos('a', 40.39, 49.84, 'nasimi', 0, 'assigned'), sos('b', 40.39, 49.84), sos('c', 40.39, 49.84), sos('d', 40.39, 49.84)];
    expect(detectSosCluster(list[3], list, NOW)).toBeNull();
  });
});

describe('capacity rule', () => {
  const p = (occ: number, status: AssemblyPoint['status'] = 'open'): AssemblyPoint => ({
    id: 'p', name: 'p', type: 'park', location: { lat: 0, lng: 0 }, zoneId: 'z', capacity: 1000, occupancy: occ, incoming: 0, status, updatedAt: 0,
  });
  it('alerts strictly above 95%', () => {
    expect(isOverCapacity(p(950))).toBe(false);
    expect(isOverCapacity(p(951))).toBe(true);
  });
  it('ignores closed/reserve points', () => {
    expect(isOverCapacity(p(999, 'closed'))).toBe(false);
  });
  it('picks the nearest reserve point', () => {
    const pts = [
      { ...p(0, 'reserve'), id: 'far', location: { lat: 40.5, lng: 49.9 } },
      { ...p(0, 'reserve'), id: 'near', location: { lat: 40.39, lng: 49.84 } },
      { ...p(0, 'open'), id: 'open', location: { lat: 40.39, lng: 49.84 } },
    ];
    expect(pickReservePoint({ lat: 40.39, lng: 49.84 }, pts)?.id).toBe('near');
  });
});

describe('pickBrigade', () => {
  const b = (id: string, type: Brigade['type'], lat: number, status: Brigade['status'] = 'available'): Brigade => ({
    id, name: id, type, location: { lat, lng: 49.84 }, base: { lat, lng: 49.84 }, status, targetSosIds: [], updatedAt: 0,
  });
  it('prefers a specialised unit when distances are comparable', () => {
    const r = pickBrigade({ lat: 40.39, lng: 49.84 }, 'fire', [b('med', 'medical', 40.391), b('fire', 'fire', 40.3915)]);
    expect(r?.id).toBe('fire');
  });
  it('skips busy units', () => {
    const r = pickBrigade({ lat: 40.39, lng: 49.84 }, 'fire', [b('fire', 'fire', 40.39, 'en_route'), b('res', 'rescue', 40.40)]);
    expect(r?.id).toBe('res');
  });
  it('returns undefined when nobody is free', () => {
    expect(pickBrigade({ lat: 40.39, lng: 49.84 }, 'fire', [b('x', 'fire', 40.39, 'on_scene')])).toBeUndefined();
  });
});
