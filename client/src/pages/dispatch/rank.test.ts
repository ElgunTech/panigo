import { describe, expect, it } from 'vitest';
import type { Brigade, SosSignal } from '@shared/types';
import { rankUnits, wantedType } from './SosFeed';

const at = { lat: 40.39, lng: 49.84 };
const sos = (hazard: SosSignal['hazard'], priority: 1 | 2 = 2): SosSignal => ({ id: 's', citizenId: 'c', hazard, location: at, zoneId: 'z', status: 'new', priority, specialNeeds: priority === 1, createdAt: 0, updatedAt: 0 });
const unit = (id: string, type: Brigade['type'], dLat: number, status: Brigade['status'] = 'available'): Brigade => ({ id, name: id, type, location: { lat: at.lat + dLat, lng: at.lng }, base: at, status, targetSosIds: [], updatedAt: 0 });

describe('dispatcher nearest-unit preview', () => {
  it('maps hazards to unit types (P1 → medical)', () => {
    expect(wantedType(sos('fire'))).toBe('fire');
    expect(wantedType(sos('flood'))).toBe('rescue');
    expect(wantedType(sos('fire', 1))).toBe('medical');
  });

  it('puts the nearest matching unit first, even if another type is closer', () => {
    const r = rankUnits(sos('medical'), [unit('fire-near', 'fire', 0.001), unit('med-far', 'medical', 0.02), unit('med-near', 'medical', 0.005)]);
    expect(r.map((x) => x.b.id)).toEqual(['med-near', 'med-far', 'fire-near']);
  });

  it('ignores busy units and includes returning ones', () => {
    const r = rankUnits(sos('fire'), [unit('busy', 'fire', 0.001, 'en_route'), unit('back', 'fire', 0.01, 'returning')]);
    expect(r.map((x) => x.b.id)).toEqual(['back']);
  });
});
