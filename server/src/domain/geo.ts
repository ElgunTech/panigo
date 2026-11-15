import type { LatLng } from '@shared/types';

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Local equirectangular projection (metres) — accurate enough at city scale. */
function project(p: LatLng, ref: LatLng) {
  return {
    x: toRad(p.lng - ref.lng) * R * Math.cos(toRad(ref.lat)),
    y: toRad(p.lat - ref.lat) * R,
  };
}

/** Distance from point p to segment a-b in metres. */
export function pointToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const A = project(a, p);
  const B = project(b, p);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(A.x * dx + A.y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = A.x + t * dx;
  const y = A.y + t * dy;
  return Math.sqrt(x * x + y * y);
}

/** True if the polyline passes within radiusM of the centre. */
export function polylineHitsCircle(line: LatLng[], center: LatLng, radiusM: number): boolean {
  if (line.length === 1) return haversine(line[0], center) <= radiusM;
  for (let i = 1; i < line.length; i++) {
    if (pointToSegment(center, line[i - 1], line[i]) <= radiusM) return true;
  }
  return false;
}

export function polylineLength(line: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += haversine(line[i - 1], line[i]);
  return d;
}

export function centroid(points: LatLng[]): LatLng {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lng: points.reduce((s, p) => s + p.lng, 0) / n,
  };
}

/** Move `metres` along a polyline; returns new position and remaining polyline. */
export function advanceAlong(line: LatLng[], metres: number): { position: LatLng; rest: LatLng[]; arrived: boolean } {
  let remaining = metres;
  let cur = line[0];
  for (let i = 1; i < line.length; i++) {
    const seg = haversine(cur, line[i]);
    if (seg >= remaining) {
      const t = seg === 0 ? 1 : remaining / seg;
      const pos = { lat: cur.lat + (line[i].lat - cur.lat) * t, lng: cur.lng + (line[i].lng - cur.lng) * t };
      return { position: pos, rest: [pos, ...line.slice(i)], arrived: false };
    }
    remaining -= seg;
    cur = line[i];
  }
  const last = line[line.length - 1];
  return { position: last, rest: [last], arrived: true };
}

export const WALK_SPEED_MS = 1.3; // ~4.7 km/h under crowd conditions
