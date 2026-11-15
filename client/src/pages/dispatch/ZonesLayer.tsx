import { useEffect } from 'react';
import { Circle, Tooltip, useMap } from 'react-leaflet';
import type { CrisisAlert, LatLng, SosSignal, Zone } from '@shared/types';

/** Zone load heat: circle colour/opacity grows with active SOS in the zone; red pulse when an alert is open. */
export function ZonesLayer({ zones, sos, alerts, focus }: { zones: Zone[]; sos: SosSignal[]; alerts: CrisisAlert[]; focus: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
  }, [focus, map]);

  const counts = new Map<string, number>();
  for (const s of sos) counts.set(s.zoneId, (counts.get(s.zoneId) ?? 0) + 1);
  const alerted = new Set(alerts.filter((a) => a.status === 'open').map((a) => a.zoneId));

  return (
    <>
      {zones.map((z) => {
        const n = counts.get(z.id) ?? 0;
        const hot = alerted.has(z.id);
        return (
          <Circle
            key={z.id}
            center={[z.center.lat, z.center.lng]}
            radius={z.radiusM}
            pathOptions={{
              color: hot ? '#ef4444' : n ? '#f59e0b' : '#334155',
              weight: hot ? 2 : 1,
              dashArray: hot ? undefined : '4 6',
              fillColor: hot ? '#ef4444' : '#f59e0b',
              fillOpacity: hot ? 0.14 : Math.min(0.12, n * 0.02),
            }}
          >
            <Tooltip direction="center" permanent className="!bg-transparent !shadow-none !text-slate-300 !text-[11px] !font-semibold">
              {z.name}
              {n ? ` · ${n} SOS` : ''}
              {z.population ? (
                <span className="block text-[9px] font-normal text-slate-500">
                  {Math.round(z.population / 1000)}k{z.disabledPersons ? ` · ♿ ${(z.disabledPersons / 1000).toFixed(1)}k` : ''}
                </span>
              ) : null}
            </Tooltip>
          </Circle>
        );
      })}
    </>
  );
}
