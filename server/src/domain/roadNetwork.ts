import type { LatLng, RoadClosure } from '@shared/types';
import { haversine, pointToSegment } from './geo';

/**
 * Simulated city road network: a lattice of intersections over Baku with
 * 8-neighbour links (streets + diagonal avenues). Used as the internal routing
 * engine and as the fallback when the external routing API is unavailable.
 * Closures are applied at query time, so the graph itself is immutable.
 */

export interface GraphNode {
  id: number;
  pos: LatLng;
}

interface Edge {
  to: number;
  lengthM: number;
}

const LAT0 = 40.352;
const LAT1 = 40.440;
const LNG0 = 49.795;
const LNG1 = 49.975;
const DLAT = 0.0042;
const DLNG = 0.0056;

/** Rough Caspian coastline (lat below which there is sea) by longitude. */
const COAST: [number, number][] = [
  [49.79, 40.348], [49.82, 40.352], [49.84, 40.360], [49.86, 40.367],
  // east of Ağ Şəhər the shore turns south towards Zığ (verified against OSM tiles)
  [49.88, 40.371], [49.90, 40.373], [49.92, 40.365], [49.94, 40.355], [49.98, 40.350],
];

function coastLat(lng: number): number {
  if (lng <= COAST[0][0]) return COAST[0][1];
  for (let i = 1; i < COAST.length; i++) {
    const [x1, y1] = COAST[i];
    const [x0, y0] = COAST[i - 1];
    if (lng <= x1) return y0 + ((lng - x0) / (x1 - x0)) * (y1 - y0);
  }
  return COAST[COAST.length - 1][1];
}

export function isOnLand(p: LatLng): boolean {
  return p.lat >= coastLat(p.lng);
}

export class RoadNetwork {
  readonly nodes: GraphNode[] = [];
  private adj: Edge[][] = [];

  constructor() {
    const rows = Math.round((LAT1 - LAT0) / DLAT) + 1;
    const cols = Math.round((LNG1 - LNG0) / DLNG) + 1;
    const index = new Map<string, number>();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pos = { lat: +(LAT0 + r * DLAT).toFixed(5), lng: +(LNG0 + c * DLNG).toFixed(5) };
        if (!isOnLand(pos)) continue;
        const id = this.nodes.length;
        this.nodes.push({ id, pos });
        this.adj.push([]);
        index.set(`${r}:${c}`, id);
      }
    }
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = index.get(`${r}:${c}`);
        if (a === undefined) continue;
        for (const [dr, dc] of dirs) {
          const b = index.get(`${r + dr}:${c + dc}`);
          if (b === undefined) continue;
          const lengthM = haversine(this.nodes[a].pos, this.nodes[b].pos);
          this.adj[a].push({ to: b, lengthM });
          this.adj[b].push({ to: a, lengthM });
        }
      }
    }
  }

  nearestNode(p: LatLng, closures: RoadClosure[] = []): number {
    let best = -1;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (closures.some((c) => haversine(n.pos, c.location) <= c.radiusM)) continue;
      const d = haversine(n.pos, p);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  private blocked(a: GraphNode, b: GraphNode, closures: RoadClosure[]): boolean {
    for (const c of closures) {
      if (pointToSegment(c.location, a.pos, b.pos) <= c.radiusM) return true;
    }
    return false;
  }

  /**
   * A* shortest path avoiding closures. Returns node positions or null when
   * no path exists. `congestion` lets callers weight edges (traffic model).
   */
  shortestPath(from: LatLng, to: LatLng, closures: RoadClosure[] = [], congestion?: (a: LatLng, b: LatLng) => number): LatLng[] | null {
    const s = this.nearestNode(from, closures);
    const t = this.nearestNode(to, closures);
    if (s < 0 || t < 0) return null;
    if (s === t) return [from, to];

    const g = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const closed = new Uint8Array(this.nodes.length);
    const target = this.nodes[t].pos;
    const open = new MinHeap();
    g[s] = 0;
    open.push(s, haversine(this.nodes[s].pos, target));

    while (open.size) {
      const u = open.pop()!;
      if (u === t) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const e of this.adj[u]) {
        if (closed[e.to]) continue;
        const A = this.nodes[u];
        const B = this.nodes[e.to];
        if (closures.length && this.blocked(A, B, closures)) continue;
        const w = e.lengthM * (congestion ? congestion(A.pos, B.pos) : 1);
        const cand = g[u] + w;
        if (cand < g[e.to]) {
          g[e.to] = cand;
          prev[e.to] = u;
          open.push(e.to, cand + haversine(B.pos, target));
        }
      }
    }
    if (g[t] === Infinity) return null;
    const path: LatLng[] = [];
    for (let v = t; v !== -1; v = prev[v]) path.push(this.nodes[v].pos);
    path.reverse();
    return [from, ...path, to];
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number | undefined {
    if (!this.ids.length) return undefined;
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
