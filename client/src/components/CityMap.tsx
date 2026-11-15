import { useEffect, type ReactNode } from 'react';
import L from 'leaflet';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { AssemblyPoint, Brigade, LatLng, RoadClosure, RouteResult, SosSignal } from '@shared/types';
import { HAZARD_COLOR, occColor, pct } from '../lib/format';

export const BAKU_CENTER: LatLng = { lat: 40.395, lng: 49.865 };

/** Tile source is configurable (VITE_TILE_URL) so a self-hosted/offline tile server can be swapped in during an outage. */
const TILE_URL = import.meta.env.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function CityMap({ theme, children, className }: { theme: 'light' | 'dark'; children?: ReactNode; className?: string }) {
  return (
    <MapContainer center={[BAKU_CENTER.lat, BAKU_CENTER.lng]} zoom={13} className={className} zoomControl={false} preferCanvas>
      <TileLayer url={TILE_URL} className={theme === 'dark' ? 'tiles-dark' : 'tiles-light'} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
      <ZoomBottomRight />
      {children}
    </MapContainer>
  );
}

function ZoomBottomRight() {
  const map = useMap();
  useEffect(() => {
    const z = L.control.zoom({ position: 'bottomright' });
    z.addTo(map);
    return () => {
      z.remove();
    };
  }, [map]);
  return null;
}

export function MapClick({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export function FitTo({ points, deps }: { points: LatLng[]; deps: unknown }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.flyToBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [60, 60], maxZoom: 15, duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  return null;
}

export function PointsLayer({ points, highlight, onSelect, labels }: { points: AssemblyPoint[]; highlight?: string; onSelect?: (p: AssemblyPoint) => void; labels: (p: AssemblyPoint) => string }) {
  return (
    <>
      {points.map((p) => {
        const v = pct(p);
        const reserve = p.status === 'reserve';
        const closed = p.status === 'closed';
        const color = reserve ? '#64748b' : closed ? '#334155' : occColor(v);
        const r = 7 + Math.sqrt(p.capacity) / 14;
        return (
          <CircleMarker
            key={p.id}
            center={[p.location.lat, p.location.lng]}
            radius={highlight === p.id ? r + 4 : r}
            pathOptions={{ color: highlight === p.id ? '#0f172a' : 'white', weight: highlight === p.id ? 3 : 2, fillColor: color, fillOpacity: reserve || closed ? 0.45 : 0.9, dashArray: reserve ? '3 3' : undefined }}
            eventHandlers={{ click: () => onSelect?.(p) }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {labels(p)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

export function ClosuresLayer({ closures }: { closures: RoadClosure[] }) {
  return (
    <>
      {closures.map((c) => (
        <Circle key={c.id} center={[c.location.lat, c.location.lng]} radius={c.radiusM} pathOptions={{ color: '#dc2626', weight: 2, dashArray: '6 6', fillColor: '#dc2626', fillOpacity: 0.18 }}>
          <Tooltip>
            ⛔ {c.name} — {c.reason}
          </Tooltip>
        </Circle>
      ))}
    </>
  );
}

export function RouteLayer({ route, previous }: { route: RouteResult | null; previous?: RouteResult | null }) {
  return (
    <>
      {previous && <Polyline positions={previous.geometry.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#94a3b8', weight: 4, opacity: 0.6, dashArray: '4 8' }} />}
      {route && (
        <>
          <Polyline positions={route.geometry.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#1e3a8a', weight: 9, opacity: 0.25 }} />
          <Polyline positions={route.geometry.map((p) => [p.lat, p.lng])} pathOptions={{ color: route.degraded ? '#7c3aed' : '#2563eb', weight: 5, opacity: 0.95, dashArray: route.provider === 'straight' ? '8 8' : undefined }} />
        </>
      )}
    </>
  );
}

export function SosLayer({ sos, label }: { sos: SosSignal[]; label: (s: SosSignal) => string }) {
  return (
    <>
      {sos.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.location.lat, s.location.lng]}
          radius={s.status === 'new' ? 7 : 5}
          pathOptions={{ color: s.status === 'new' ? '#fff' : HAZARD_COLOR[s.hazard], weight: 2, fillColor: HAZARD_COLOR[s.hazard], fillOpacity: s.status === 'resolved' ? 0.25 : 0.95 }}
        >
          <Tooltip>{label(s)}</Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

const brigadeIcon = (b: Brigade) =>
  L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div class="brigade-pin brigade-${b.type} ${b.status}">${{ fire: 'Y', medical: 'T', rescue: 'X' }[b.type]}</div>`,
  });

export function BrigadesLayer({ brigades, label }: { brigades: Brigade[]; label: (b: Brigade) => string }) {
  return (
    <>
      {brigades.map((b) => (
        <span key={b.id}>
          {b.route && b.route.length > 1 && <Polyline positions={b.route.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#f59e0b', weight: 3, opacity: 0.9, dashArray: '2 6' }} />}
          <Marker position={[b.location.lat, b.location.lng]} icon={brigadeIcon(b)}>
            <Tooltip>{label(b)}</Tooltip>
          </Marker>
        </span>
      ))}
    </>
  );
}

const youIcon = L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="you-pin"></div>' });

export function YouMarker({ at }: { at: LatLng }) {
  return <Marker position={[at.lat, at.lng]} icon={youIcon} />;
}
