import { z } from 'zod';
import { HAZARDS } from '@shared/types';
import { CITY_BOUNDS } from '../data/seed';

/** Input contracts — every write endpoint is validated (security + robustness). */
export const latLng = z.object({
  lat: z.number().finite().min(CITY_BOUNDS.minLat).max(CITY_BOUNDS.maxLat),
  lng: z.number().finite().min(CITY_BOUNDS.minLng).max(CITY_BOUNDS.maxLng),
});

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s.replace(/[<>]/g, ''));

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const planSchema = z.object({
  location: latLng,
  pointId: z.string().max(64).optional(),
});

export const sosSchema = z.object({
  hazard: z.enum(HAZARDS as [string, ...string[]]),
  location: latLng,
  note: text(280).optional(),
});

export const safeSchema = z.object({
  safe: z.boolean(),
  location: latLng.optional(),
});

export const closureSchema = z.object({
  name: text(120).pipe(z.string().min(1)),
  location: latLng,
  radiusM: z.number().int().min(50).max(2000).default(250),
  reason: text(200).default('Yol bağlanıb'),
});

export const pointPatchSchema = z
  .object({
    occupancy: z.number().int().min(0).max(1_000_000).optional(),
    occupancyPct: z.number().min(0).max(100).optional(),
    status: z.enum(['open', 'closed', 'reserve']).optional(),
  })
  .refine((v) => v.occupancy !== undefined || v.occupancyPct !== undefined || v.status !== undefined, 'empty patch');

export const dispatchSchema = z.object({
  brigadeId: z.string().max(64),
  sosIds: z.array(z.string().max(64)).min(1).max(100),
});

export const outageSchema = z.object({
  provider: z.string().max(32),
  down: z.boolean(),
});

export const scenarioSchema = z.object({
  epicenter: latLng.optional(),
});
