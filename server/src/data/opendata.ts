import fs from 'node:fs';
import path from 'node:path';
import type { LatLng } from '@shared/types';

/**
 * Official datasets from opendata.az (Açıq Məlumatlar Portalı), imported by
 * scripts/fetch-opendata-az.mjs. Optional: the system works without it.
 */
export interface MetroExit extends LatLng {
  label: string;
  address: string;
}

export interface OpendataAz {
  source: string;
  fetchedAt: string;
  sources: { dataset: string; slug: string; organization: string; license: string; modified: string; url: string }[];
  metroExits: Record<string, { name: string; nameEn: string; exits: MetroExit[] }>;
  metroRidership: Record<string, { name: string; avgDaily: number; days: number }>;
  venues: { name: string; address: string; location: LatLng; source: string }[];
  districts: Record<string, { population: number; areaKm2: number; densityPerKm2: number; year: number; disabledPersons?: number; disabledYear?: number }>;
  collapseStats: { year: number; incidents: number; deaths: number; injured: number; rescued: number }[];
}

function load(): OpendataAz | null {
  if (process.env.OPENDATA_AZ === 'off') return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'opendata-az.json'), 'utf8')) as OpendataAz;
  } catch {
    return null;
  }
}

export const ODAZ = load();

/** Same normalisation as the import script: "28-May", "28 May 2-ci çıxış m/st" → "28may". */
export function stationKey(s: string): string {
  let k = String(s)
    .replace(/\[cite:[^\]]*\]/g, '')
    .trim()
    .toLowerCase()
    .replace(/m\/st.*$|stansiyası|sığınacağı|\d+-ci çıxış.*$|çıxış.*$/g, '')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/[^a-z0-9]+/g, '');
  if (/^2805/.test(k)) k = '28may';
  if (k.endsWith('xetai')) k = 'xetai';
  if (k.startsWith('nerimannerimanov')) k = 'nerimanov';
  return k;
}

/** Rough evacuation capacity for an official sport venue from its name. */
export function venueCapacity(name: string): number {
  if (/stadion|olimpiya idman kompleksi/i.test(name)) return 5000;
  if (/arena|saray|kompleks|mərkəz|park/i.test(name)) return 3000;
  if (/zal/i.test(name)) return 800;
  return 1500;
}
