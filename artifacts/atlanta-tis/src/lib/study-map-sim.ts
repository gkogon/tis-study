/**
 * Geometry and flow model behind `StudyMapAlive` — the live study map that
 * runs while a TIS generates and then carries the report's trip assignment.
 *
 * Pure TypeScript, no DOM: `scripts/check-study-map-sim.mjs` exercises it
 * under plain node. The road graph mirrors the engine's own
 * (`tis-api-server/src/lib/network-assignment.ts` buildGraph): nodes keyed
 * on 5-decimal lat/lon, one-way honoured at adjacency-build time, link cost
 * = free-flow minutes from the segment's maxspeed or its class default.
 */

/** [classCode, aLat, aLon, bLat, bLon, lanes|null, maxspeed|null, name?, oneway?] — api-server RoadSegment */
export type RoadSegment = [number, number, number, number, number, number | null, number | null, (string | null)?, (number | null)?];

export type LatLon = { lat: number; lon: number };

/** free-flow speed per functional class, mph — network-assignment.ts CLASS_FREE_MPH */
const CLASS_FREE_MPH = [60, 45, 40, 35, 30];

export function distMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type Link = { a: number; b: number; lenMi: number; freeMin: number; cls: number; dir: 0 | 1 | -1 };
export type RoadGraph = {
  links: Link[];
  adj: number[][];
  nodeLat: number[];
  nodeLon: number[];
  nearestNode: (lat: number, lon: number) => number;
};

export function buildRoadGraph(segments: RoadSegment[]): RoadGraph {
  const nodeIdx = new Map<string, number>();
  const nodeLat: number[] = [], nodeLon: number[] = [];
  const nodeOf = (la: number, lo: number): number => {
    const k = `${la.toFixed(5)},${lo.toFixed(5)}`;
    let i = nodeIdx.get(k);
    if (i === undefined) { i = nodeLat.length; nodeIdx.set(k, i); nodeLat.push(la); nodeLon.push(lo); }
    return i;
  };
  const links: Link[] = [], adj: number[][] = [];
  const addAdj = (n: number, li: number) => { (adj[n] ??= []).push(li); };
  for (const s of segments) {
    const cls = Math.min(4, Math.max(0, s[0] | 0));
    const a = nodeOf(s[1], s[2]), b = nodeOf(s[3], s[4]);
    if (a === b) continue;
    const lenMi = distMi(s[1], s[2], s[3], s[4]);
    if (!(lenMi > 0)) continue;
    const mph = typeof s[6] === "number" && s[6] > 0 ? s[6] : (CLASS_FREE_MPH[cls] ?? 30);
    const raw = s[8];
    const dir: 0 | 1 | -1 = raw === 1 ? 1 : raw === -1 ? -1 : 0;
    const li = links.length;
    links.push({ a, b, lenMi, freeMin: (lenMi / mph) * 60, cls, dir });
    if (dir !== -1) addAdj(a, li);
    if (dir !== 1) addAdj(b, li);
  }
  for (let i = 0; i < nodeLat.length; i++) adj[i] ??= [];
  const nearestNode = (lat: number, lon: number): number => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodeLat.length; i++) {
      const d = distMi(lat, lon, nodeLat[i] ?? 0, nodeLon[i] ?? 0);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  return { links, adj, nodeLat, nodeLon, nearestNode };
}

/** Minimal binary min-heap on (cost, node). */
class Heap {
  private c: number[] = [];
  private n: number[] = [];
  get size(): number { return this.c.length; }
  push(cost: number, node: number): void {
    const c = this.c, n = this.n;
    c.push(cost); n.push(node);
    let i = c.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((c[p] ?? 0) <= (c[i] ?? 0)) break;
      [c[p], c[i]] = [c[i] ?? 0, c[p] ?? 0]; [n[p], n[i]] = [n[i] ?? 0, n[p] ?? 0];
      i = p;
    }
  }
  pop(): [number, number] {
    const c = this.c, n = this.n;
    const top: [number, number] = [c[0] ?? 0, n[0] ?? 0];
    const lc = c.pop() ?? 0, ln = n.pop() ?? 0;
    if (c.length) {
      c[0] = lc; n[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < c.length && (c[l] ?? 0) < (c[m] ?? 0)) m = l;
        if (r < c.length && (c[r] ?? 0) < (c[m] ?? 0)) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i] ?? 0, c[m] ?? 0]; [n[m], n[i]] = [n[i] ?? 0, n[m] ?? 0];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Dijkstra from `from` over free-flow minutes; returns the node path to each
 * target (empty array when unreachable). Directed: a one-way link is only
 * walkable the legal way because the graph only lists it on that side.
 */
export function shortestPaths(g: RoadGraph, from: number, targets: number[]): number[][] {
  const N = g.nodeLat.length;
  const dist = new Float64Array(N).fill(Infinity);
  const pred = new Int32Array(N).fill(-1);
  const heap = new Heap();
  if (from >= 0 && from < N) { dist[from] = 0; heap.push(0, from); }
  const want = new Set(targets);
  let found = 0;
  while (heap.size && found < want.size) {
    const [d, u] = heap.pop();
    if (d > (dist[u] ?? Infinity)) continue;
    if (want.has(u)) { found++; }
    for (const li of g.adj[u] ?? []) {
      const L = g.links[li];
      if (!L) continue;
      const v = L.a === u ? L.b : L.a;
      const nd = d + L.freeMin;
      if (nd < (dist[v] ?? Infinity)) { dist[v] = nd; pred[v] = u; heap.push(nd, v); }
    }
  }
  return targets.map((t) => {
    if (!(t >= 0 && t < N) || !Number.isFinite(dist[t] ?? Infinity)) return [];
    const path: number[] = [];
    for (let u = t; u !== -1; u = pred[u] ?? -1) { path.push(u); if (u === from) break; }
    return path.reverse();
  });
}

/** A polyline of lat/lon with cumulative miles, ready for cars to ride. */
export type Route = { pts: LatLon[]; cum: number[]; lenMi: number };

export function routeFromNodes(g: RoadGraph, nodes: number[]): Route | null {
  if (nodes.length < 2) return null;
  const pts: LatLon[] = [], cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] ?? 0;
    const p = { lat: g.nodeLat[n] ?? 0, lon: g.nodeLon[n] ?? 0 };
    if (i > 0) { const q = pts[i - 1]; if (q) acc += distMi(q.lat, q.lon, p.lat, p.lon); }
    pts.push(p); cum.push(acc);
  }
  return acc > 0 ? { pts, cum, lenMi: acc } : null;
}

/** Straight-line fallback when there is no road network for the region. */
export function straightRoute(a: LatLon, b: LatLon): Route {
  const len = distMi(a.lat, a.lon, b.lat, b.lon);
  return { pts: [a, b], cum: [0, len], lenMi: len };
}

export function pointAlong(r: Route, sMi: number): LatLon {
  if (sMi <= 0) return r.pts[0] ?? { lat: 0, lon: 0 };
  if (sMi >= r.lenMi) return r.pts[r.pts.length - 1] ?? { lat: 0, lon: 0 };
  let i = 1;
  while (i < r.cum.length && (r.cum[i] ?? 0) < sMi) i++;
  const a = r.pts[i - 1], b = r.pts[i], c0 = r.cum[i - 1] ?? 0, c1 = r.cum[i] ?? c0;
  if (!a || !b) return a ?? { lat: 0, lon: 0 };
  const t = c1 > c0 ? (sMi - c0) / (c1 - c0) : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** One flow = cars leaving the site along one route at a rate. */
export type Flow = { route: Route; ratePerS: number; tint: "project" | "background" };
export type Car = { flow: number; s: number; v: number };

/**
 * Cars on routes. `ratePerS` is cars per simulated second; speeds are free
 * flow for the class mix (30 mph nominal), so a car crosses a 0.5-mi radius
 * in about a minute of simulated time.
 */
export class FlowSim {
  readonly flows: Flow[];
  cars: Car[] = [];
  private seed = 17;
  constructor(flows: Flow[]) { this.flows = flows; }
  private rnd(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  step(dt: number): void {
    for (let i = 0; i < this.flows.length; i++) {
      const f = this.flows[i];
      if (!f || f.ratePerS <= 0) continue;
      if (this.rnd() < f.ratePerS * dt) this.cars.push({ flow: i, s: 0, v: (28 + 8 * this.rnd()) / 3600 });
    }
    for (const c of this.cars) c.s += c.v * dt;
    this.cars = this.cars.filter((c) => c.s < (this.flows[c.flow]?.route.lenMi ?? 0) + 0.02);
  }
  /** cars per simulated hour actually launched on a flow, for the check */
  static expectedPerHour(f: Flow): number { return f.ratePerS * 3600; }
}

/** Equirectangular projection centred on the site — good to a few metres at study scale. */
export function projector(center: LatLon, pxPerMi: number, cx: number, cy: number): (p: LatLon) => [number, number] {
  const kLat = 69.172, kLon = 69.172 * Math.cos((center.lat * Math.PI) / 180);
  return (p) => [cx + (p.lon - center.lon) * kLon * pxPerMi, cy - (p.lat - center.lat) * kLat * pxPerMi];
}

export type Los = "A" | "B" | "C" | "D" | "E" | "F";
export const LOS_MAP_COLORS: Record<string, string> = { A: "#22C55E", B: "#22C55E", C: "#EAB308", D: "#F59E0B", E: "#EF4444", F: "#DC2626" };
