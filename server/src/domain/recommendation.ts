import { CRISIS_RULES, type AssemblyPoint, type LatLng, type PointOption } from '@shared/types';
import { haversine } from './geo';
import { occupancyPct } from './crisisEngine';

/**
 * Ranks assembly points for a citizen. Projected occupancy includes people
 * already en route ("incoming") so that we do not send everyone to the same
 * half-empty point (herding effect).
 */
export function rankPoints(origin: LatLng, points: AssemblyPoint[], fullPct: number = CRISIS_RULES.rerouteFullPct): PointOption[] {
  return points
    .filter((p) => p.status === 'open')
    .map((point) => {
      const pct = occupancyPct(point);
      const projected = ((point.occupancy + point.incoming) / point.capacity) * 100;
      return {
        point,
        distanceM: Math.round(haversine(origin, point.location)),
        occupancyPct: Math.round(pct * 10) / 10,
        full: pct >= fullPct,
        projected,
      };
    })
    .sort((a, b) => score(a) - score(b))
    .map(({ projected: _p, ...rest }) => rest);
}

/** Lower is better: distance in metres, inflated as the point fills up. */
function score(o: { distanceM: number; projected: number; full: boolean }): number {
  if (o.full) return 1e9 + o.distanceM;
  const crowdPenalty = o.projected > 70 ? 1 + (o.projected - 70) / 20 : 1;
  return o.distanceM * crowdPenalty;
}

/** Candidates eligible as destination (not full), best first. */
export function eligible(options: PointOption[], exclude: string[] = []): PointOption[] {
  return options.filter((o) => !o.full && !exclude.includes(o.point.id));
}
