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

/**
 * mobility_impaired = citizen with reduced mobility / special-care needs
 * (Challenge Drop 1): SOS is auto-escalated to Priority #1 and evacuation is
 * restricted to step-free, wheelchair/medical-transport accessible routes.
 */
export type Role = 'citizen' | 'mobility_impaired' | 'dispatcher' | 'admin';
export const ROLES: Role[] = ['citizen', 'mobility_impaired', 'dispatcher', 'admin'];

/** 1 = critical (special-needs citizen), 2 = normal */
export type SosPriority = 1 | 2;

/** standard = pedestrian, accessible = step-free pedestrian/wheelchair, vehicle = rescue brigades */
export type RouteProfile = 'standard' | 'accessible' | 'vehicle';

export interface Barrier {
  lat: number;
  lng: number;
  kind: 'steps' | 'underpass';
}

export interface Zone {
  id: string;
  name: string;
  center: LatLng;
  radiusM: number;
  /** residents (Wikidata P1082) — used to size the response per zone */
  population?: number;
  populationYear?: string;
  /** people per km² (DSK 2024, opendata.az) */
  densityPerKm2?: number;
  /** persons with disabilities in the district (DSK, opendata.az) */
  disabledPersons?: number;
}

/** Static reference facility (hospital) from the real-world dataset */
export interface Facility {
  name: string;
  location: LatLng;
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
  /** step-free / wheelchair accessible (ramps, no stairs) */
  accessible: boolean;
  /** real entrances (e.g. official metro exits, opendata.az) — pedestrians are routed to the nearest one */
  entrances?: { lat: number; lng: number; label: string }[];
  /** average daily metro ridership 2025 (opendata.az) */
  ridershipDaily?: number;
  /** data provenance */
  source?: string;
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
  /** 1 = Kritik Prioritet (special-needs citizen) */
  priority: SosPriority;
  /** sender has reduced mobility — needs accessible / medical transport */
  specialNeeds: boolean;
  createdAt: number;
  updatedAt: number;
  brigadeId?: string;
  /** server detected the brigade within 100 m of the SOS point */
  arrivedAt?: number;
  /** citizen pressed "Briqada çatdı" (validated server-side: brigade ≤ 100 m) */
  confirmedAt?: number;
}

export type BrigadeType = 'fire' | 'medical' | 'rescue';
/** returning = after the job: medical units drive to the nearest hospital, others back to base */
export type BrigadeStatus = 'available' | 'en_route' | 'on_scene' | 'returning' | 'offline';

export interface Brigade {
  id: string;
  name: string;
  type: BrigadeType;
  location: LatLng;
  base: LatLng;
  status: BrigadeStatus;
  targetSosIds: string[];
  /** SOS signals served on the last job — their citizens keep following the unit on its return trip */
  followSosIds?: string[];
  /** where the unit is heading after the job (hospital name / base) */
  destinationName?: string;
  destinationKind?: 'hospital' | 'base';
  target?: LatLng;
  route?: LatLng[];
  etaS?: number;
  updatedAt: number;
}

/** Server's choice of the nearest suitable unit for one SOS. */
export interface BrigadeRecommendation {
  brigadeId: string;
  brigadeName: string;
  brigadeType: BrigadeType;
  /** type that matches the hazard (medical / fire / rescue) */
  wantedType: BrigadeType;
  /** false = no unit of the wanted type was free, nearest other unit chosen */
  matchedType: boolean;
  distanceM: number;
  etaS: number;
}

export type AlertKind = 'sos_cluster' | 'capacity' | 'priority_sos';
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

export type RouteProviderId = 'osrm-foot' | 'osrm' | 'simulated' | 'straight';

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
  profile: RouteProfile;
  /** how the geometry was computed: on the pedestrian network or on the road network */
  mode: 'foot' | 'vehicle';
  /** stairs / stair-underpasses near the chosen route (0 = step-free) */
  barriersNear: number;
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
  /** the entrance the route leads to (nearest metro exit), if the point has several */
  entrance?: { lat: number; lng: number; label: string };
  route: RouteResult | null;
  reason: RerouteReason;
  profile: RouteProfile;
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
  hospitals?: Facility[];
  barriers?: Barrier[];
  dataSource?: string;
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
