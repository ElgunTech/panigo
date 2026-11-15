import type { AssemblyPoint, Hazard } from '@shared/types';

export const pct = (p: Pick<AssemblyPoint, 'occupancy' | 'capacity'>) => (p.capacity ? (p.occupancy / p.capacity) * 100 : 0);

export function occColor(v: number): string {
  if (v >= 95) return '#dc2626';
  if (v >= 90) return '#f97316';
  if (v >= 70) return '#eab308';
  return '#22c55e';
}

export function fmtDistance(m: number, t: { km: string; m: string }) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} ${t.km}` : `${Math.round(m)} ${t.m}`;
}

export function fmtMinutes(s: number) {
  return Math.max(1, Math.round(s / 60));
}

export function timeAgo(ts: number, t: { ago: string; justNow: string; minutes: string }) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 30) return t.justNow;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} ${t.minutes} ${t.ago}`;
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const HAZARD_COLOR: Record<Hazard, string> = {
  fire: '#f97316',
  collapse: '#a855f7',
  flood: '#0ea5e9',
  medical: '#ef4444',
};
