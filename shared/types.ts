/**
 * Shared domain contract between server and client.
 * Single source of truth for the data model — both sides import from here.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type Hazard = 'fire' | 'collapse' | 'flood' | 'medical';
export const HAZARDS: Hazard[] = ['fire', 'collapse', 'flood', 'medical'];

export type Role = 'citizen' | 'dispatcher' | 'admin';

export interface Zone {
  id: string;
  name: string;
  center: LatLng;
  radiusM: number;
}

export type AssemblyPointType = 'shelter' | 'park' | 'stadium';
/** reserve = prepared but not yet opened; can be opened by a dispatcher decision */
export type AssemblyPointStatus = 'open' | 'closed' | 'reserve';

export interface AssemblyPoint {
  id: string;
  name: string;
  type: AssemblyPointType;
  location: LatLng;
  zoneId: string;
  capacity: number;
  occupancy: number;
  /** citizens currently routed towards this point */
  incoming: number;
  status: AssemblyPointStatus;
  updatedAt: number;
}

export interface RoadClosure {
  id: string;
  name: string;
  location: LatLng;
  radiusM: number;
  reason: string;
  createdAt: number;
}

export type SosStatus = 'new' | 'assigned' | 'resolved' | 'cancelled';

export interface SosSignal {
  id: string;
  citizenId: string;
  hazard: Hazard;
  location: LatLng;
  zoneId: string;
  note?: string;
  status: SosStatus;
  createdAt: number;
  updatedAt: number;
  brigadeId?: string;
}

export type BrigadeType = 'fire' | 'medical' | 'rescue';
export type BrigadeStatus = 'available' | 'en_route' | 'on_scene' | 'offline';

export interface Brigade {
  id: string;
  name: string;
  type: BrigadeType;
  location: LatLng;
  base: LatLng;
  status: BrigadeStatus;
  targetSosIds: string[];
  target?: LatLng;
  route?: LatLng[];
  etaS?: number;
  updatedAt: number;
}

export type AlertKind = 'sos_cluster' | 'capacity';
export type AlertStatus = 'open' | 'executed' | 'dismissed';

export interface AlertRecommendation {
  brigadeId?: string;
  newPointId?: string;
}

export interface CrisisAlert {
  id: string;
  kind: AlertKind;
  zoneId: string;
  center: LatLng;
  sosIds: string[];
  distinctCitizens: number;
  pointId?: string;
  occupancyPct?: number;
  status: AlertStatus;
  recommendation: AlertRecommendation;
  createdAt: number;
  updatedAt: number;
  decidedBy?: string;
  outcome?: string;
}

export interface CitizenStatus {
  citizenId: string;
  safe: boolean;
  location?: LatLng;
  destinationPointId?: string;
  updatedAt: number;
}

export type RouteProviderId = 'osrm' | 'simulated' | 'straight';

export interface RouteResult {
  provider: RouteProviderId;
  geometry: LatLng[];
  distanceM: number;
  /** driving duration */
  durationS: number;
  /** walking duration (evacuation on foot) */
  walkS: number;
  /** true when served by a fallback provider */
  degraded: boolean;
}

export interface PointOption {
  point: AssemblyPoint;
  distanceM: number;
  occupancyPct: number;
  full: boolean;
}

export type RerouteReason = 'initial' | 'road_closed' | 'point_full' | 'point_closed' | 'manual';

export interface EvacuationPlan {
  citizenId: string;
  origin: LatLng;
  options: PointOption[];
  destination: AssemblyPoint | null;
  route: RouteResult | null;
  reason: RerouteReason;
  previousPointId?: string;
  createdAt: number;
}

export interface ProviderHealth {
  id: RouteProviderId;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  forcedDown: boolean;
  lastError?: string;
}

export interface SystemStatus {
  providers: ProviderHealth[];
  scenarioRunning: boolean;
  uptimeS: number;
}

/** Public snapshot (citizen) */
export interface PublicSnapshot {
  zones: Zone[];
  points: AssemblyPoint[];
  closures: RoadClosure[];
}

/** Full snapshot (dispatcher) */
export interface DispatchSnapshot extends PublicSnapshot {
  sos: SosSignal[];
  brigades: Brigade[];
  alerts: CrisisAlert[];
  citizens: CitizenStatus[];
  system: SystemStatus;
}

export type LiveEvent =
  | { type: 'sos.upsert'; data: SosSignal }
  | { type: 'point.upsert'; data: AssemblyPoint }
  | { type: 'closure.upsert'; data: RoadClosure }
  | { type: 'closure.remove'; data: { id: string } }
  | { type: 'brigade.upsert'; data: Brigade }
  | { type: 'alert.upsert'; data: CrisisAlert }
  | { type: 'citizen.upsert'; data: CitizenStatus }
  | { type: 'plan.update'; data: EvacuationPlan }
  | { type: 'system.status'; data: SystemStatus };

export type LiveEventType = LiveEvent['type'];

/** Crisis thresholds — shared so the UI can explain the rules */
export const CRISIS_RULES = {
  sosWindowMs: 5 * 60 * 1000,
  sosRadiusM: 500,
  sosMinDistinct: 4,
  capacityAlertPct: 95,
  rerouteFullPct: 90,
} as const;
