import { describe, expect, it } from 'vitest';
import type { SosSignal } from '@shared/types';
import { applyEvents, emptyState } from './liveState';

const sos = (id: string, createdAt = 0): SosSignal => ({ id, citizenId: 'c', hazard: 'fire', location: { lat: 0, lng: 0 }, zoneId: 'z', status: 'new', priority: 2, specialNeeds: false, createdAt, updatedAt: createdAt });

describe('liveState reducer', () => {
  it('upserts and removes entities immutably', () => {
    const s1 = applyEvents(emptyState, [{ type: 'sos.upsert', data: sos('a') }, { type: 'closure.upsert', data: { id: 'r', name: 'x', reason: 'x', radiusM: 1, location: { lat: 0, lng: 0 }, createdAt: 0 } }]);
    expect(Object.keys(s1.sos)).toEqual(['a']);
    expect(emptyState.sos).toEqual({});
    const s2 = applyEvents(s1, [{ type: 'closure.remove', data: { id: 'r' } }]);
    expect(s2.closures).toEqual({});
    expect(s2.sos).toBe(s1.sos); // untouched slices keep identity (cheap re-render)
  });

  it('bounds SOS memory under load', () => {
    const events = Array.from({ length: 2500 }, (_, i) => ({ type: 'sos.upsert' as const, data: sos(`s${i}`, i) }));
    const s = applyEvents(emptyState, events);
    expect(Object.keys(s.sos)).toHaveLength(2000);
    expect(s.sos['s2499']).toBeDefined();
    expect(s.sos['s0']).toBeUndefined();
  });
});
