/**
 * The Pittsburgh sample-study opener's world (components/
 * pittsburgh-alive-opener.tsx): the study's own road network and signals,
 * projected to feet around the site, with traffic driven by the same
 * car-following rule as the home-page opener (`car-following.ts`).
 *
 * What is the study's and what is illustrative:
 *   - the roads are the /api/roads network the live study map draws; the
 *     signals are the report's 36 rows at their own coordinates, each
 *     running its own cycle and green splits (row.signalTiming), coloured by
 *     its own No-Build / Build LOS;
 *   - background cars arrive on each studied approach at that approach's
 *     No-Build volume (approaches[].existingVolumeVph) and project cars leave
 *     / reach the site on routes to each row at its addedTripsPmPeak — but
 *     they ride short through-routes on a free-flow car-following model, so
 *     the motion is an illustration of the study, not a simulation of it.
 *     The opener says so in its HUD; every number it states is the report's.
 *
 * Pure TypeScript — no DOM at construction, `step()` or `setRoads()` — so
 * scripts/check-pittsburgh-study-private.mjs runs it under plain node.
 * `draw()` is the only method that touches a canvas context.
 *
 * World units are feet; x east, y SOUTH (canvas convention); the site is the
 * origin.
 */
import { CAR_L, CAR_W, GAP, followGap, targetSpeed, stepSpeed } from "./car-following.ts";
import type { RoadSegment } from "./study-map-sim.ts";
import type { TisAffectedIntersection } from "@workspace/tis-api-client-react";

export const FT_PER_MI = 5280;
/** Miles per degree of latitude (the live study map's projector constant). */
const MI_PER_DEG_LAT = 69.172;
/** Free-flow speed per functional class, mph — the engine's CLASS_FREE_MPH. */
const CLASS_FREE_MPH = [60, 50, 40, 30, 25];
const KMH_PER_MPH = 1.609344;
/** Reaction margin behind the car ahead, s (the home opener's TUNING.headwayS). */
const HEADWAY_S = 1.8;
/** Stop line, ft before the junction centre on the route. */
const STOP_BACK_FT = 42;
/** A route "passes" a signal when it comes within this many feet of it. */
const PASS_FT = 55;
/** How far ahead a car reads its next signal, ft. */
const LOOKAHEAD_FT = 900;
/** Fade a car in over the first, and out over the last, this many feet of an open-ended route. */
const FADE_FT = 160;
const YELLOW_S = 3;

export type Los = "A" | "B" | "C" | "D" | "E" | "F";
/** The page's own LOS palette (tis-report-bits LOS_COLORS[g].map), so the
 *  opener's squares match the LOS map and charts below it. */
export const LOS_COLORS: Record<Los, string> = {
  A: "#10b981", B: "#22c55e", C: "#eab308", D: "#f59e0b", E: "#f97316", F: "#dc2626",
};
const asLos = (x: string | undefined): Los => (x === "A" || x === "B" || x === "C" || x === "D" || x === "E" || x === "F" ? x : "C");
const losRank = (l: Los): number => "ABCDEF".indexOf(l);

export type Camera = { x: number; y: number; s: number };

export type AliveSignal = {
  id: string;
  name: string;
  x: number;
  y: number;
  featured: boolean;
  /** No-Build (opening-year background) and Build LOS. */
  losNoBuild: Los;
  losBuild: Los;
  /** Build grade worse than No-Build. */
  drop: boolean;
  C: number;
  gNs: number;
  gEw: number;
  off: number;
  /** Distance from the site, ft — the reveal order. */
  dist: number;
  /** Approaches the row loads (No-Build or Build volume > 0); a route only
   *  stops here when it arrives on one of them, so a divided road's other
   *  carriageway passes by. */
  loaded: ReadonlySet<string>;
};

type Route = { xs: Float32Array; ys: Float32Array; cum: Float32Array; len: number; ow: Uint8Array; fadeIn: boolean; fadeOut: boolean; stops: Stop[] };
type Stop = { sig: AliveSignal; s: number; axis: 0 | 1; key: string };
type Car = { s: number; v: number; k: number; i: number; d: number; dg: number; dist: number };
type Flow = { route: Route; rate: number; project: boolean; cars: Car[] };

export type SceneState = {
  /** 0..1 pin drop, 0..1 building height. */
  pinDrop: number;
  build: number;
  /** 0..1 the featured signal's ring and heads. */
  featured: number;
  /** 0..1 how many studied signals show their LOS square (nearest first). */
  losReveal: number;
  /** 0 = No-Build colours, 1 = Build colours. */
  losMix: number;
  /** 0..1 the study-radius ring. */
  ring: number;
  /** 0..1 the road network's fade-in after it loads. */
  roads: number;
  /** canvas labels (decorative; the HUD carries the facts) */
  siteLabel: string;
  /** short label beside the zoomed-out site marker */
  siteMarker: string;
  featuredLabel: string;
};

export type SceneInput = {
  site: { lat: number; lon: number };
  radiusMi: number;
  rows: readonly TisAffectedIntersection[];
  featuredId: string | null;
  /** Side of the illustrative building footprint, ft. */
  footprintFt: number;
  /** PM peak in / out shares of the net new trips (inbound / outbound project flows). */
  pmIn: number;
  pmOut: number;
};

export function ease(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Equirectangular feet about the site — the live map's projector, in feet. */
export function worldProjector(site: { lat: number; lon: number }): (lat: number, lon: number) => [number, number] {
  const kLat = MI_PER_DEG_LAT * FT_PER_MI, kLon = kLat * Math.cos((site.lat * Math.PI) / 180);
  return (lat, lon) => [(lon - site.lon) * kLon, -(lat - site.lat) * kLat];
}

// ---------------------------------------------------------------------------
// road graph in feet (nodes keyed on 5-decimal lat/lon, one-way honoured —
// the same keying and costs as study-map-sim's buildRoadGraph)
// ---------------------------------------------------------------------------

type Graph = {
  nx: Float64Array; ny: Float64Array;
  la: Int32Array; lb: Int32Array; lcost: Float64Array; ldir: Int8Array; lcls: Uint8Array; lname: (string | null)[];
  out: number[][]; inn: number[][];
  cell: number; grid: Map<string, number[]>;
};

function buildGraph(segments: readonly RoadSegment[], proj: (lat: number, lon: number) => [number, number]): Graph {
  const idx = new Map<string, number>();
  const nx: number[] = [], ny: number[] = [];
  const node = (lat: number, lon: number): number => {
    const k = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    let i = idx.get(k);
    if (i === undefined) { i = nx.length; idx.set(k, i); const [x, y] = proj(lat, lon); nx.push(x); ny.push(y); }
    return i;
  };
  const la: number[] = [], lb: number[] = [], lcost: number[] = [], ldir: number[] = [], lcls: number[] = [], lname: (string | null)[] = [];
  for (const s of segments) {
    const a = node(s[1], s[2]), b = node(s[3], s[4]);
    if (a === b) continue;
    const len = Math.hypot((nx[b] ?? 0) - (nx[a] ?? 0), (ny[b] ?? 0) - (ny[a] ?? 0));
    if (!(len > 0)) continue;
    const cls = Math.min(6, Math.max(0, s[0] | 0));
    const kmh = s[6];
    const mph = typeof kmh === "number" && kmh > 0 ? kmh / KMH_PER_MPH : (CLASS_FREE_MPH[Math.min(4, cls)] ?? 25);
    la.push(a); lb.push(b); lcost.push(len / mph); lcls.push(cls); lname.push(s[7] ?? null);
    ldir.push(s[8] === 1 ? 1 : s[8] === -1 ? -1 : 0);
  }
  const N = nx.length;
  const out: number[][] = Array.from({ length: N }, () => []);
  const inn: number[][] = Array.from({ length: N }, () => []);
  for (let li = 0; li < la.length; li++) {
    const a = la[li]!, b = lb[li]!, d = ldir[li]!;
    if (d !== -1) { out[a]!.push(li); inn[b]!.push(li); }
    if (d !== 1) { out[b]!.push(li); inn[a]!.push(li); }
  }
  const cell = 400;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < N; i++) {
    const k = `${Math.floor(nx[i]! / cell)},${Math.floor(ny[i]! / cell)}`;
    let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); } arr.push(i);
  }
  return {
    nx: Float64Array.from(nx), ny: Float64Array.from(ny),
    la: Int32Array.from(la), lb: Int32Array.from(lb), lcost: Float64Array.from(lcost), ldir: Int8Array.from(ldir), lcls: Uint8Array.from(lcls), lname,
    out, inn, cell, grid,
  };
}

/** Nodes within r ft of (x, y), nearest first. */
function nodesNear(g: Graph, x: number, y: number, r: number): number[] {
  const out: Array<[number, number]> = [];
  const c0 = Math.floor((x - r) / g.cell), c1 = Math.floor((x + r) / g.cell);
  const r0 = Math.floor((y - r) / g.cell), r1 = Math.floor((y + r) / g.cell);
  for (let cx = c0; cx <= c1; cx++) {
    for (let cy = r0; cy <= r1; cy++) {
      for (const i of g.grid.get(`${cx},${cy}`) ?? []) {
        const d = Math.hypot(g.nx[i]! - x, g.ny[i]! - y);
        if (d <= r) out.push([d, i]);
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]).map((p) => p[1]);
}

function nearestNode(g: Graph, x: number, y: number): number {
  for (const r of [300, 1200, 4000, 16000]) { const n = nodesNear(g, x, y, r); if (n.length) return n[0]!; }
  return -1;
}

const other = (g: Graph, li: number, u: number): number => (g.la[li] === u ? g.lb[li]! : g.la[li]!);

/** Dijkstra over free-flow cost from `src`, forward along legal links (or
 *  backward when `reverse`, so pred walks lead TO src). Returns pred node and
 *  pred link per node. */
function dijkstra(g: Graph, src: number, reverse: boolean): { pred: Int32Array; plink: Int32Array; dist: Float64Array } {
  const N = g.nx.length;
  const dist = new Float64Array(N).fill(Infinity);
  const pred = new Int32Array(N).fill(-1);
  const plink = new Int32Array(N).fill(-1);
  const hc: number[] = [], hn: number[] = [];
  const push = (c: number, n: number) => {
    hc.push(c); hn.push(n);
    let i = hc.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (hc[p]! <= hc[i]!) break; [hc[p], hc[i]] = [hc[i]!, hc[p]!]; [hn[p], hn[i]] = [hn[i]!, hn[p]!]; i = p; }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [hc[0]!, hn[0]!];
    const lc = hc.pop()!, ln = hn.pop()!;
    if (hc.length) {
      hc[0] = lc; hn[0] = ln;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hc.length && hc[l]! < hc[m]!) m = l;
        if (r < hc.length && hc[r]! < hc[m]!) m = r;
        if (m === i) break;
        [hc[m], hc[i]] = [hc[i]!, hc[m]!]; [hn[m], hn[i]] = [hn[i]!, hn[m]!]; i = m;
      }
    }
    return top;
  };
  if (src < 0) return { pred, plink, dist };
  dist[src] = 0; push(0, src);
  const adj = reverse ? g.inn : g.out;
  while (hc.length) {
    const [d, u] = pop();
    if (d > dist[u]!) continue;
    for (const li of adj[u]!) {
      const v = other(g, li, u);
      const nd = d + g.lcost[li]!;
      if (nd < dist[v]!) { dist[v] = nd; pred[v] = u; plink[v] = li; push(nd, v); }
    }
  }
  return { pred, plink, dist };
}

/** Greedy walk along the road from `start`: downstream follows legal
 *  outgoing links in the travel heading, upstream follows legal incoming
 *  links against it. Prefers the same road name and class. Returns the
 *  nodes walked (excluding start), nearest first. */
function walk(g: Graph, start: number, hx: number, hy: number, lengthFt: number, upstream: boolean): number[] {
  const out: number[] = [];
  const seen = new Set<number>([start]);
  let u = start, acc = 0, name: string | null = null, cls = -1;
  let dx = hx, dy = hy;
  while (acc < lengthFt && out.length < 400) {
    let best = -1, bestScore = 0.35, bestV = -1;
    for (const li of (upstream ? g.inn : g.out)[u]!) {
      const v = other(g, li, u);
      if (seen.has(v)) continue;
      const ex = g.nx[v]! - g.nx[u]!, ey = g.ny[v]! - g.ny[u]!;
      const L = Math.hypot(ex, ey); if (!(L > 0)) continue;
      // travel direction along this link: u→v downstream, v→u upstream
      const tx = (upstream ? -ex : ex) / L, ty = (upstream ? -ey : ey) / L;
      let score = tx * dx + ty * dy;
      if (score < 0.35) continue;
      if (name !== null && g.lname[li] === name) score += 0.6;
      if (cls >= 0 && g.lcls[li] === cls) score += 0.2;
      if (score > bestScore) { bestScore = score; best = li; bestV = v; }
    }
    if (best < 0) break;
    const ex = g.nx[bestV]! - g.nx[u]!, ey = g.ny[bestV]! - g.ny[u]!, L = Math.hypot(ex, ey);
    const tx = (upstream ? -ex : ex) / L, ty = (upstream ? -ey : ey) / L;
    const nd = Math.hypot(dx * 0.55 + tx * 0.45, dy * 0.55 + ty * 0.45) || 1;
    dx = (dx * 0.55 + tx * 0.45) / nd; dy = (dy * 0.55 + ty * 0.45) / nd;
    name = g.lname[best] ?? null; cls = g.lcls[best]!;
    acc += L; seen.add(bestV); out.push(bestV); u = bestV;
  }
  return out;
}

/** The link joining consecutive nodes a→b (either orientation). */
function linkBetween(g: Graph, a: number, b: number): number {
  for (const li of g.out[a]!) if (other(g, li, a) === b) return li;
  for (const li of g.inn[a]!) if (other(g, li, a) === b) return li;
  return -1;
}

function routeFrom(g: Graph, nodes: number[], pre: [number, number] | null, post: [number, number] | null, fadeIn: boolean, fadeOut: boolean): Route | null {
  const xs: number[] = [], ys: number[] = [], ow: number[] = [];
  if (pre) { xs.push(pre[0]); ys.push(pre[1]); ow.push(1); }
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    xs.push(g.nx[n]!); ys.push(g.ny[n]!);
    if (i > 0) { const li = linkBetween(g, nodes[i - 1]!, n); ow.push(li >= 0 && g.ldir[li] !== 0 ? 1 : 0); }
  }
  if (post) { xs.push(post[0]); ys.push(post[1]); ow.push(1); }
  if (xs.length < 2) return null;
  const cum = new Float32Array(xs.length);
  for (let i = 1; i < xs.length; i++) cum[i] = cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!);
  const len = cum[xs.length - 1]!;
  if (!(len > 50)) return null;
  // ow[i] describes segment i (from vertex i to i+1); pad to vertex count
  while (ow.length < xs.length) ow.push(ow[ow.length - 1] ?? 0);
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys), cum, len, ow: Uint8Array.from(ow), fadeIn, fadeOut, stops: [] };
}

/** Where the route comes closest to (x, y): [distance ft, s along route, segment index]. */
function closestOnRoute(r: Route, x: number, y: number): [number, number, number] {
  let best = Infinity, bs = 0, bi = 0;
  for (let i = 1; i < r.xs.length; i++) {
    const ax = r.xs[i - 1]!, ay = r.ys[i - 1]!, bx = r.xs[i]!, by = r.ys[i]!;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (d < best) { best = d; bs = r.cum[i - 1]! + t * Math.sqrt(l2); bi = i - 1; }
  }
  return [best, bs, bi];
}

function attachStops(r: Route, sigs: readonly AliveSignal[]): void {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < r.xs.length; i++) { x0 = Math.min(x0, r.xs[i]!); x1 = Math.max(x1, r.xs[i]!); y0 = Math.min(y0, r.ys[i]!); y1 = Math.max(y1, r.ys[i]!); }
  for (const sig of sigs) {
    if (sig.x < x0 - PASS_FT || sig.x > x1 + PASS_FT || sig.y < y0 - PASS_FT || sig.y > y1 + PASS_FT) continue;
    const [d, s, i] = closestOnRoute(r, sig.x, sig.y);
    if (d > PASS_FT || s < STOP_BACK_FT + 20) continue;
    const dx = r.xs[i + 1]! - r.xs[i]!, dy = r.ys[i + 1]! - r.ys[i]!;
    const axis: 0 | 1 = Math.abs(dy) >= Math.abs(dx) ? 0 : 1;
    const dir = axis === 0 ? (dy < 0 ? "NB" : "SB") : dx > 0 ? "EB" : "WB";
    if (!sig.loaded.has(dir)) continue;
    r.stops.push({ sig, s: s - STOP_BACK_FT, axis, key: `${sig.id}:${dir}` });
  }
  r.stops.sort((a, b) => a.s - b.s);
}

const HEADING: Record<string, [number, number]> = { NB: [0, -1], SB: [0, 1], EB: [1, 0], WB: [-1, 0] };

// ---------------------------------------------------------------------------
// the world
// ---------------------------------------------------------------------------

/** Road drawing bins: 0 motorway … 4 local, 5 residential / service. */
const ROAD_BIN_STYLE: Array<{ c: string; ft: number; px: number }> = [
  { c: "#44557A", ft: 78, px: 3.4 },
  { c: "#3D4E6E", ft: 62, px: 2.8 },
  { c: "#354562", ft: 48, px: 2.2 },
  { c: "#2F3D57", ft: 38, px: 1.6 },
  { c: "#29364C", ft: 30, px: 1.1 },
  { c: "#212C40", ft: 24, px: 0.7 },
];

type RoadLayer = { bins: Float32Array[]; paths: unknown[] | null };

export class PghAliveSim {
  readonly sigs: AliveSignal[];
  readonly featured: AliveSignal | null;
  readonly radiusFt: number;
  readonly footprintFt: number;
  readonly toWorld: (lat: number, lon: number) => [number, number];
  /** The illustrative massing: building, parking field and parcel, ft. The
   *  GLA as one store wider than deep, set just east of the pin (the open
   *  land beside it) with its parking in front; the pin stays the study's
   *  site point, where every project route starts and ends. */
  readonly site: { bx0: number; by0: number; bx1: number; by1: number; kx0: number; ky0: number; kx1: number; ky1: number; px0: number; py0: number; px1: number; py1: number; cx: number; cy: number };
  roads: RoadLayer | null = null;
  flows: Flow[] = [];
  /** the site's driveway: where the network meets the site, ft */
  driveway: [number, number] | null = null;
  simT = 0;
  /** background demand multiplier (1 = the approaches' No-Build volumes) */
  demand = 1;
  /** project-trip multiplier (0 before the site is built) */
  projMul = 0;
  private seed = 23;
  private readonly input: SceneInput;
  private roadCache: { canvas: unknown; key: string } | null = null;
  private lastCamKey = "";

  constructor(input: SceneInput) {
    this.input = input;
    this.toWorld = worldProjector(input.site);
    this.radiusFt = input.radiusMi * FT_PER_MI;
    this.footprintFt = input.footprintFt;
    {
      const area = input.footprintFt * input.footprintFt;
      const w = Math.sqrt(area * 1.6), d = area / w;
      const bx0 = 40, bx1 = 40 + w, by0 = -d / 2 - 40, by1 = d / 2 - 40;
      const kx0 = bx0 - 30, kx1 = bx1 + 40, ky0 = by1 + 34, ky1 = by1 + 34 + 4 * 62 + 10;
      const px0 = Math.min(bx0, kx0) - 30, px1 = Math.max(bx1, kx1) + 30, py0 = by0 - 40, py1 = ky1 + 24;
      this.site = { bx0, by0, bx1, by1, kx0, ky0, kx1, ky1, px0, py0, px1, py1, cx: (px0 + px1) / 2, cy: (py0 + py1) / 2 };
    }
    let k = 0;
    this.sigs = input.rows.map((r) => {
      const [x, y] = this.toWorld(r.latitude, r.longitude);
      const t = r.signalTiming;
      const C = t && t.cycleLenSec > 0 ? t.cycleLenSec : 90;
      const losNoBuild = asLos(r.existingLos), losBuild = asLos(r.futureLos);
      return {
        id: r.signalId, name: r.name, x, y, featured: r.signalId === input.featuredId,
        losNoBuild, losBuild, drop: losRank(losBuild) > losRank(losNoBuild),
        C, gNs: t ? t.gOverCns : 0.45, gEw: t ? t.gOverCew : 0.45, off: ((k++ * 37) % 97) / 97 * C,
        dist: Math.hypot(x, y),
        loaded: new Set((r.approaches ?? []).filter((a) => a.existingVolumeVph > 0 || a.futureVolumeVph > 0).map((a) => a.direction)),
      };
    });
    this.featured = this.sigs.find((s) => s.featured) ?? null;
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** The light for `axis` (0 NS, 1 EW) at time t: the row's own cycle and g/C. */
  light(sig: AliveSignal, axis: 0 | 1, t: number = this.simT): "G" | "Y" | "R" {
    const C = sig.C, gN = sig.gNs * C, gE = sig.gEw * C;
    const half = Math.max(0, (C - gN - gE) / 2), y = Math.min(YELLOW_S, half);
    const u = (t + sig.off) % C;
    if (u < gN) return axis === 0 ? "G" : "R";
    if (u < gN + y) return axis === 0 ? "Y" : "R";
    if (u < gN + half) return "R";
    if (u < gN + half + gE) return axis === 1 ? "G" : "R";
    if (u < gN + half + gE + y) return axis === 1 ? "Y" : "R";
    return "R";
  }

  /**
   * Load the road network: the drawing layer, the routing graph, and the
   * flows — through-routes on every studied approach at its No-Build volume,
   * and project routes between the site and every row at its project trips.
   */
  setRoads(segments: readonly RoadSegment[]): void {
    const bins: number[][] = [[], [], [], [], [], []];
    for (const s of segments) {
      const cls = s[0] | 0;
      const b = cls <= 0 ? 0 : cls >= 5 ? 5 : cls;
      const [ax, ay] = this.toWorld(s[1], s[2]), [bx, by] = this.toWorld(s[3], s[4]);
      bins[b]!.push(ax, ay, bx, by);
    }
    this.roads = { bins: bins.map((b) => Float32Array.from(b)), paths: null };
    this.roadCache = null;
    if (segments.length === 0) { this.flows = []; return; }

    const g = buildGraph(segments, this.toWorld);
    const flows: Flow[] = [];
    const siteNode = nearestNode(g, 0, 0);
    if (siteNode >= 0) this.driveway = [g.nx[siteNode]!, g.ny[siteNode]!];
    const fwd = dijkstra(g, siteNode, false);
    const rev = dijkstra(g, siteNode, true);
    const net = Math.max(1, this.input.pmIn + this.input.pmOut);
    const inShare = this.input.pmIn / net, outShare = this.input.pmOut / net;
    const site: [number, number] = [0, 0];

    for (const row of this.input.rows) {
      const sig = this.sigs.find((s) => s.id === row.signalId);
      if (!sig) continue;
      const near = nodesNear(g, sig.x, sig.y, 260);

      // background: one through-route per loaded approach, at its No-Build vph
      for (const a of row.approaches ?? []) {
        if (!(a.existingVolumeVph > 0)) continue;
        const h = HEADING[a.direction];
        if (!h) continue;
        const [hx, hy] = h;
        let start = -1;
        for (const n of near) {
          const okIn = g.inn[n]!.some((li) => { const v = other(g, li, n); const ex = g.nx[n]! - g.nx[v]!, ey = g.ny[n]! - g.ny[v]!; const L = Math.hypot(ex, ey); return L > 0 && (ex * hx + ey * hy) / L > 0.5; });
          const okOut = g.out[n]!.some((li) => { const v = other(g, li, n); const ex = g.nx[v]! - g.nx[n]!, ey = g.ny[v]! - g.ny[n]!; const L = Math.hypot(ex, ey); return L > 0 && (ex * hx + ey * hy) / L > 0.5; });
          if (okIn && okOut) { start = n; break; }
        }
        if (start < 0) continue;
        const up = walk(g, start, hx, hy, 1300, true).reverse();
        const down = walk(g, start, hx, hy, 950, false);
        const route = routeFrom(g, [...up, start, ...down], null, null, true, true);
        if (!route) continue;
        flows.push({ route, rate: a.existingVolumeVph / 3600, project: false, cars: [] });
      }

      // project: out from the site to the row, and in from beyond the row to the site
      const target = near.length ? near[0]! : nearestNode(g, sig.x, sig.y);
      const added = row.addedTripsPmPeak;
      if (target >= 0 && added > 0) {
        if (fwd.pred[target] !== -1 || target === siteNode) {
          const path: number[] = [];
          for (let u = target; u !== -1; u = fwd.pred[u]!) { path.push(u); if (u === siteNode) break; }
          path.reverse();
          const last = path[path.length - 1]!, prev = path[path.length - 2];
          let ext: number[] = [];
          if (prev !== undefined) {
            const ex = g.nx[last]! - g.nx[prev]!, ey = g.ny[last]! - g.ny[prev]!, L = Math.hypot(ex, ey) || 1;
            ext = walk(g, last, ex / L, ey / L, 700, false);
          }
          const route = routeFrom(g, [...path, ...ext], site, null, false, true);
          if (route) flows.push({ route, rate: (added * outShare) / 3600, project: true, cars: [] });
        }
        // inbound: the reverse tree's path from the row's node to the site,
        // started upstream of the row so its cars queue at the signal
        let src = -1;
        for (const n of near) if (rev.pred[n] !== -1) { src = n; break; }
        if (src >= 0) {
          const path: number[] = [];
          for (let u = src; u !== -1; u = rev.pred[u]!) { path.push(u); if (u === siteNode) break; }
          const nxt = path[1];
          let pre: number[] = [];
          if (nxt !== undefined) {
            const ex = g.nx[nxt]! - g.nx[src]!, ey = g.ny[nxt]! - g.ny[src]!, L = Math.hypot(ex, ey) || 1;
            pre = walk(g, src, ex / L, ey / L, 900, true).reverse();
          }
          const route = routeFrom(g, [...pre, ...path], null, site, true, false);
          if (route) flows.push({ route, rate: (added * inShare) / 3600, project: true, cars: [] });
        }
      }
    }
    for (const f of flows) attachStops(f.route, this.sigs);
    this.flows = flows;
  }

  /** Flows (for the check): route length, rate, project flag, stops. */
  flowSummary(): Array<{ lenFt: number; ratePerHour: number; project: boolean; stops: string[] }> {
    return this.flows.map((f) => ({ lenFt: f.route.len, ratePerHour: f.rate * 3600, project: f.project, stops: f.route.stops.map((s) => s.key) }));
  }

  carCount(): { total: number; project: number; stopped: number } {
    let total = 0, project = 0, stopped = 0;
    for (const f of this.flows) for (const c of f.cars) { total++; if (f.project) project++; if (c.v < 1) stopped++; }
    return { total, project, stopped };
  }

  step(dtIn: number): void {
    // sub-step so a long frame never jumps a stop line
    const n = Math.max(1, Math.ceil(dtIn / 0.25));
    for (let k = 0; k < n; k++) this.substep(dtIn / n);
  }

  private substep(dt: number): void {
    this.simT += dt;
    const t = this.simT;
    // spawn
    for (const f of this.flows) {
      const mul = f.project ? this.projMul : this.demand;
      if (mul <= 0) continue;
      if (this.rnd() < f.rate * mul * dt) {
        const tail = f.cars[f.cars.length - 1];
        if (!tail || tail.s > CAR_L + GAP + 24) f.cars.push({ s: 0, v: f.project ? 18 : 40, k: 0, i: 0, d: Infinity, dg: Infinity, dist: Infinity });
      }
    }
    // constraint from the car ahead on the same flow, and from the signal
    const groups = new Map<string, Car[]>();
    for (const f of this.flows) {
      const r = f.route;
      for (let i = 0; i < f.cars.length; i++) {
        const c = f.cars[i]!;
        let d = Infinity;
        const ahead = i > 0 ? f.cars[i - 1] : undefined;
        if (ahead) d = followGap(ahead.s - c.s, c.v, HEADWAY_S);
        while (c.k < r.stops.length && r.stops[c.k]!.s < c.s - 2) c.k++;
        c.dist = Infinity;
        const st = r.stops[c.k];
        if (st) {
          const dd = st.s - c.s;
          if (dd < LOOKAHEAD_FT) {
            c.dist = dd;
            const L = this.light(st.sig, st.axis, t);
            if ((L === "R" || (L === "Y" && dd > 28)) && dd > -2) d = Math.min(d, dd);
            let arr = groups.get(st.key); if (!arr) { arr = []; groups.set(st.key, arr); } arr.push(c);
          }
        }
        c.d = d;
        c.dg = Infinity;
      }
    }
    // cars from different flows on the same approach queue behind each other
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => a.dist - b.dist);
      for (let i = 1; i < arr.length; i++) {
        const a = arr[i - 1]!, b = arr[i]!;
        b.dg = Math.min(b.dg, followGap(b.dist - a.dist, b.v, HEADWAY_S));
      }
    }
    for (const f of this.flows) {
      for (const c of f.cars) {
        // the signal and the car ahead on the same route stop a car dead at
        // the constraint; a car merging from another route only brakes
        c.v = stepSpeed(c.v, targetSpeed(Math.min(c.d, c.dg)), dt);
        if (c.d <= 1) c.v = 0;
        c.s += c.v * dt;
      }
      if (f.cars.length && f.cars[0]!.s > f.route.len) f.cars = f.cars.filter((c) => c.s <= f.route.len);
    }
  }

  // ------------------------------------------------------------------ draw

  private roadPaths(): unknown[] | null {
    if (!this.roads) return null;
    if (this.roads.paths) return this.roads.paths;
    if (typeof Path2D === "undefined") return null;
    this.roads.paths = this.roads.bins.map((b) => {
      const p = new Path2D();
      for (let i = 0; i < b.length; i += 4) { p.moveTo(b[i]!, b[i + 1]!); p.lineTo(b[i + 2]!, b[i + 3]!); }
      return p;
    });
    return this.roads.paths;
  }

  /** Viewports at least this wide put the HUD beside the scene; narrower ones put it below. */
  static readonly WIDE_PX = 860;

  /** Screen centre of the camera focus: right of the HUD on wide screens, above it on narrow. */
  static focus(vw: number, vh: number): [number, number] {
    const wide = vw >= PghAliveSim.WIDE_PX;
    // the site header (≈ 64 px) sits over the top of the scene: centre on what is left
    return [wide ? vw * 0.5 + Math.min(220, vw * 0.16) : vw * 0.5, wide ? vh * 0.5 + 30 : vh * 0.36 + 12];
  }

  private drawRoads(ctx: CanvasRenderingContext2D, dpr: number, S: number, ox: number, oy: number, alpha: number): void {
    const paths = this.roadPaths() as Path2D[] | null;
    if (!paths || alpha <= 0) return;
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * ox, dpr * oy);
    ctx.lineCap = "round";
    ctx.globalAlpha = alpha;
    for (let b = 5; b >= 0; b--) {
      const st = ROAD_BIN_STYLE[b]!;
      ctx.strokeStyle = st.c;
      ctx.lineWidth = Math.max(st.px / S, st.ft);
      ctx.stroke(paths[b]!);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Paint one frame. The road layer is cached in an offscreen canvas while
   * the camera holds still, so a resting act costs the cars and the signals
   * only.
   */
  draw(ctx: CanvasRenderingContext2D, vw: number, vh: number, dpr: number, cam: Camera, st: SceneState): void {
    const S = cam.s;
    const [fx, fy] = PghAliveSim.focus(vw, vh);
    const ox = fx - cam.x * S, oy = fy - cam.y * S;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0B1220";
    ctx.fillRect(0, 0, vw, vh);

    // roads: drawn straight onto the frame while the camera moves; once it
    // has held still for a frame, painted once into an offscreen layer and
    // blitted from then on, so a resting act costs the cars and signals only
    if (this.roads && st.roads > 0) {
      const key = `${vw}x${vh}@${dpr}:${cam.x.toFixed(1)},${cam.y.toFixed(1)},${S.toFixed(5)}`;
      const still = key === this.lastCamKey;
      this.lastCamKey = key;
      const cache = this.roadCache;
      if (st.roads >= 1 && cache && cache.key === key) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(cache.canvas as HTMLCanvasElement, 0, 0);
      } else if (st.roads >= 1 && still && typeof document !== "undefined") {
        const off = (cache?.canvas as HTMLCanvasElement | undefined) ?? document.createElement("canvas");
        const w = Math.round(vw * dpr), h = Math.round(vh * dpr);
        if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
        const c2 = off.getContext("2d");
        if (c2) { c2.setTransform(1, 0, 0, 1, 0, 0); c2.clearRect(0, 0, w, h); this.drawRoads(c2, dpr, S, ox, oy, 1); }
        this.roadCache = { canvas: off, key };
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, 0, 0);
      } else {
        this.drawRoads(ctx, dpr, S, ox, oy, st.roads);
      }
    }

    const W = (px: number) => px / S; // screen px → world ft
    ctx.setTransform(dpr * S, 0, 0, dpr * S, dpr * ox, dpr * oy);

    // study radius
    if (st.ring > 0.001) {
      ctx.strokeStyle = `rgba(59,130,246,${(0.6 * Math.min(1, st.ring * 1.5)).toFixed(3)})`;
      ctx.lineWidth = W(1.6);
      ctx.setLineDash([W(7), W(7)]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radiusFt * ease(st.ring), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(59,130,246,${(0.035 * st.ring).toFixed(3)})`;
      ctx.fill();
    }

    // driveway stub
    if (this.driveway && st.build > 0.2) {
      ctx.strokeStyle = "#2A374E";
      ctx.lineWidth = Math.max(W(1.2), 26);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(this.driveway[0], this.driveway[1]); ctx.stroke();
    }

    // cars first, so project trips pull out from under the store and the
    // inbound ones disappear into it
    this.drawCars(ctx, S, true);
    this.drawCars(ctx, S, false);
    this.drawSite(ctx, S, st);
    this.drawSignals(ctx, S, st);
  }

  private carPose(r: Route, c: Car): [number, number, number, number] {
    let i = c.i;
    while (i < r.cum.length - 2 && r.cum[i + 1]! < c.s) i++;
    c.i = i;
    const a0 = r.cum[i]!, a1 = r.cum[i + 1] ?? a0;
    const t = a1 > a0 ? Math.min(1, Math.max(0, (c.s - a0) / (a1 - a0))) : 0;
    const x0 = r.xs[i]!, y0 = r.ys[i]!, x1 = r.xs[i + 1] ?? x0, y1 = r.ys[i + 1] ?? y0;
    const L = Math.hypot(x1 - x0, y1 - y0) || 1;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    // two-way links: keep to the right of the centreline
    const off = r.ow[i] ? 0 : 11;
    return [x0 + (x1 - x0) * t - uy * off, y0 + (y1 - y0) * t + ux * off, ux, uy];
  }

  /** Background (`under` = queues + background cars) or project cars, batched into a few fills. */
  private drawCars(ctx: CanvasRenderingContext2D, S: number, under: boolean): void {
    const L = Math.max(CAR_L, 4.2 / S), Wd = Math.max(CAR_W, 2.2 / S);
    const rect = (x: number, y: number, ux: number, uy: number, l: number, w: number) => {
      const hx = (ux * l) / 2, hy = (uy * l) / 2, wx = (-uy * w) / 2, wy = (ux * w) / 2;
      ctx.moveTo(x + hx + wx, y + hy + wy); ctx.lineTo(x + hx - wx, y + hy - wy); ctx.lineTo(x - hx - wx, y - hy - wy); ctx.lineTo(x - hx + wx, y - hy + wy); ctx.closePath();
    };
    const alphaOf = (r: Route, c: Car): number => {
      let a = 1;
      if (r.fadeIn) a = Math.min(a, c.s / FADE_FT);
      if (r.fadeOut) a = Math.min(a, (r.len - c.s) / FADE_FT);
      return Math.max(0, Math.min(1, a));
    };
    if (under) {
      // standing queues: a red underlay beneath every stopped car waiting on a signal
      ctx.fillStyle = "rgba(239,68,68,0.36)";
      ctx.beginPath();
      for (const f of this.flows) for (const c of f.cars) {
        if (c.v > 3 || !(c.dist < LOOKAHEAD_FT)) continue;
        const [x, y, ux, uy] = this.carPose(f.route, c);
        rect(x, y, ux, uy, L + CAR_L * 0.9, Wd + Math.max(8, 3 / S));
      }
      ctx.fill();
      // background cars, two tints for texture, faded at open route ends
      for (const pass of [0, 1] as const) {
        ctx.fillStyle = pass === 0 ? "rgba(220,227,238,0.82)" : "rgba(220,227,238,0.45)";
        ctx.beginPath();
        for (const f of this.flows) {
          if (f.project) continue;
          for (let k = 0; k < f.cars.length; k++) {
            const c = f.cars[k]!;
            const a = alphaOf(f.route, c);
            if ((a > 0.55 ? 0 : 1) !== pass || a <= 0.05) continue;
            const [x, y, ux, uy] = this.carPose(f.route, c);
            rect(x, y, ux, uy, L, Wd);
          }
        }
        ctx.fill();
      }
      return;
    }
    // project cars: glow, body, then headlights when close enough to see them
    if (this.projMul <= 0 && !this.flows.some((f) => f.project && f.cars.length)) return;
    ctx.fillStyle = "rgba(59,130,246,0.3)";
    ctx.beginPath();
    for (const f of this.flows) if (f.project) for (const c of f.cars) { if (alphaOf(f.route, c) < 0.3) continue; const [x, y, ux, uy] = this.carPose(f.route, c); rect(x, y, ux, uy, L + Math.max(8, 4 / S), Wd + Math.max(8, 4 / S)); }
    ctx.fill();
    ctx.fillStyle = "#60A5FA";
    ctx.beginPath();
    for (const f of this.flows) if (f.project) for (const c of f.cars) { if (alphaOf(f.route, c) < 0.3) continue; const [x, y, ux, uy] = this.carPose(f.route, c); rect(x, y, ux, uy, L, Wd); }
    ctx.fill();
    if (S > 0.3) {
      ctx.fillStyle = "#FBBF24";
      ctx.beginPath();
      for (const f of this.flows) for (const c of f.cars) {
        if (alphaOf(f.route, c) < 0.5) continue;
        const [x, y, ux, uy] = this.carPose(f.route, c);
        const fx = x + (ux * L) / 2, fy = y + (uy * L) / 2;
        rect(fx - ux * 1.2 - uy * 2.2, fy - uy * 1.2 + ux * 2.2, ux, uy, 2.4, 1.6);
        rect(fx - ux * 1.2 + uy * 2.2, fy - uy * 1.2 - ux * 2.2, ux, uy, 2.4, 1.6);
      }
      ctx.fill();
    }
  }

  private drawSite(ctx: CanvasRenderingContext2D, S: number, st: SceneState): void {
    const { bx0: x0, by0: y0, bx1: x1, by1: y1, px0, py0, px1, py1, kx0, ky0, kx1, ky1 } = this.site;
    const W = (px: number) => px / S;
    const b = ease(st.build);
    const h = Math.min(x1 - x0, y1 - y0) * 0.22 * b;
    // parcel pad and its outline (amber while it is still a pin, quieter once built)
    ctx.fillStyle = b > 0 ? "#111B2D" : "#0F1726";
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    ctx.strokeStyle = `rgba(251,191,36,${(0.9 - 0.6 * b).toFixed(2)})`;
    ctx.lineWidth = W(1.5);
    ctx.setLineDash([W(8), W(6)]);
    ctx.strokeRect(px0, py0, px1 - px0, py1 - py0);
    ctx.setLineDash([]);
    // the parking field in front of the store: rows of stalls, drawn once it is close enough to read
    if (b > 0.05) {
      ctx.globalAlpha = Math.min(1, b * 1.6);
      ctx.fillStyle = "#18233A";
      ctx.fillRect(kx0, ky0, kx1 - kx0, ky1 - ky0);
      if (S > 0.25) {
        ctx.strokeStyle = "rgba(148,163,184,0.28)";
        ctx.lineWidth = W(1);
        ctx.beginPath();
        for (let y = ky0 + 22; y + 18 <= ky1 - 10; y += 62) {
          for (let x = kx0 + 14; x <= kx1 - 14; x += 9.5) { ctx.moveTo(x, y); ctx.lineTo(x, y + 18); ctx.moveTo(x, y + 20); ctx.lineTo(x, y + 38); }
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (h > 0.5) {
      const ox = -0.3 * h, oy = -0.45 * h;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.moveTo(x1, y0); ctx.lineTo(x1 + 0.35 * h, y0 + 0.5 * h); ctx.lineTo(x1 + 0.35 * h, y1 + 0.5 * h);
      ctx.lineTo(x0 + 0.35 * h, y1 + 0.5 * h); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#1E2A3F";
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1 + ox, y1 + oy); ctx.lineTo(x1 + ox, y0 + oy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#26344C";
      ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1 + ox, y1 + oy); ctx.lineTo(x0 + ox, y1 + oy); ctx.closePath(); ctx.fill();
      // storefronts along the front face, lit
      const glow = Math.min(1, b * 1.2);
      ctx.fillStyle = `rgba(253,230,138,${(0.55 * glow).toFixed(2)})`;
      const bays = 9;
      for (let k = 0; k < bays; k++) {
        const u0 = (k + 0.12) / bays, u1 = (k + 0.88) / bays;
        const ax = x0 + u0 * (x1 - x0), bx = x0 + u1 * (x1 - x0);
        ctx.beginPath();
        ctx.moveTo(ax + ox * 0.15, y1 + oy * 0.15); ctx.lineTo(bx + ox * 0.15, y1 + oy * 0.15);
        ctx.lineTo(bx + ox * 0.55, y1 + oy * 0.55); ctx.lineTo(ax + ox * 0.55, y1 + oy * 0.55); ctx.closePath(); ctx.fill();
      }
      // roof, with a skylight grid and rooftop plant
      ctx.fillStyle = "#34435E";
      ctx.fillRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
      ctx.strokeStyle = "#4B5B78";
      ctx.lineWidth = W(1);
      ctx.strokeRect(x0 + ox, y0 + oy, x1 - x0, y1 - y0);
      if (S > 0.2) {
        ctx.fillStyle = "rgba(148,163,184,0.16)";
        const cols = 8, rows = 4, cw = (x1 - x0) / cols, rh = (y1 - y0) / rows;
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) ctx.fillRect(x0 + ox + i * cw + cw * 0.38, y0 + oy + j * rh + rh * 0.4, cw * 0.24, rh * 0.2);
      }
      ctx.fillStyle = "#2C3A52";
      ctx.fillRect(x0 + ox + (x1 - x0) * 0.1, y0 + oy + (y1 - y0) * 0.14, (x1 - x0) * 0.16, (y1 - y0) * 0.22);
      ctx.fillRect(x0 + ox + (x1 - x0) * 0.7, y0 + oy + (y1 - y0) * 0.56, (x1 - x0) * 0.14, (y1 - y0) * 0.26);
      // the label reads only while the camera is close; zoomed out the site marker below carries it
      const la = Math.min(Math.max(0, (b - 0.6) / 0.3), Math.max(0, Math.min(1, (S - 0.12) / 0.15)));
      if (la > 0 && st.siteLabel) {
        ctx.globalAlpha = la;
        ctx.fillStyle = "#F1F5F9";
        ctx.font = `600 ${W(12)}px "JetBrains Mono", Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(st.siteLabel, x0 + ox, y0 + oy - W(8));
        ctx.globalAlpha = 1;
      }
    }
    // zoomed out: an amber site marker so the site stays findable among the signals
    const ma = Math.max(0, Math.min(1, (0.1 - S) / 0.04)) * b;
    if (ma > 0) {
      const cx = (px0 + px1) / 2, cy = (py0 + py1) / 2;
      ctx.globalAlpha = ma;
      ctx.strokeStyle = "#FBBF24";
      ctx.lineWidth = W(2);
      ctx.beginPath(); ctx.arc(cx, cy, W(13), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#FBBF24";
      ctx.beginPath(); ctx.arc(cx, cy, W(4), 0, Math.PI * 2); ctx.fill();
      ctx.font = `600 ${W(10)}px "JetBrains Mono", Menlo, monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(st.siteMarker, cx + W(19), cy);
      ctx.globalAlpha = 1;
    }
    if (st.pinDrop > 0) {
      const dy = W((1 - ease(st.pinDrop)) * 220);
      const a = Math.min(1, st.pinDrop * 3) * (1 - Math.min(1, st.build * 2.5));
      if (a > 0) {
        const r = W(14), tip = W(34);
        ctx.globalAlpha = a;
        ctx.fillStyle = "#FBBF24";
        ctx.beginPath();
        ctx.arc(0, -tip - dy, r, Math.PI * 0.75, Math.PI * 2.25);
        ctx.lineTo(0, -dy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#0B1220";
        ctx.beginPath(); ctx.arc(0, -tip - dy, W(5), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawSignals(ctx: CanvasRenderingContext2D, S: number, st: SceneState): void {
    const W = (px: number) => px / S;
    const t = this.simT;
    // signal heads: two per signal (NS, EW) in their phase colour, when close enough to read
    if (S > 0.12) {
      for (const sig of this.sigs) {
        const r = W(sig.featured ? 4.2 : 3.2);
        const col = (L: "G" | "Y" | "R") => (L === "G" ? "#22C55E" : L === "Y" ? "#FBBF24" : "#EF4444");
        ctx.fillStyle = "#0B1220";
        ctx.beginPath(); ctx.arc(sig.x - W(6), sig.y, r * 1.45, 0, Math.PI * 2); ctx.arc(sig.x + W(6), sig.y, r * 1.45, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col(this.light(sig, 0, t)); ctx.beginPath(); ctx.arc(sig.x - W(6), sig.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col(this.light(sig, 1, t)); ctx.beginPath(); ctx.arc(sig.x + W(6), sig.y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    // the featured signal: ring + label
    const f = this.featured;
    if (f && st.featured > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
      ctx.globalAlpha = st.featured;
      ctx.strokeStyle = "#FBBF24";
      ctx.lineWidth = W(2);
      ctx.beginPath(); ctx.arc(f.x, f.y, W(46 + 6 * pulse), 0, Math.PI * 2); ctx.stroke();
      if (st.featuredLabel) {
        ctx.fillStyle = "#FDE68A";
        ctx.font = `600 ${W(12)}px "JetBrains Mono", Menlo, monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(st.featuredLabel, f.x + W(60), f.y - W(46));
      }
      ctx.globalAlpha = 1;
    }
    // LOS squares, nearest first, No-Build → Build colours; drops ringed
    if (st.losReveal > 0) {
      const order = [...this.sigs].sort((a, b) => a.dist - b.dist);
      const n = order.length;
      const side = W(S < 0.08 ? 16 : 22);
      ctx.font = `700 ${W(S < 0.08 ? 10 : 13)}px "JetBrains Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        const sig = order[i]!;
        const a = Math.max(0, Math.min(1, st.losReveal * n - i));
        if (a <= 0) continue;
        const los = st.losMix >= 0.5 ? sig.losBuild : sig.losNoBuild;
        const sc = 0.6 + 0.4 * ease(a);
        const sz = side * sc;
        ctx.globalAlpha = a;
        if (sig.drop && st.losMix > 0) {
          const k = ease((st.losMix - 0.5) / 0.5);
          if (k > 0) {
            const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + i);
            ctx.strokeStyle = `rgba(248,250,252,${(0.85 * k).toFixed(2)})`;
            ctx.lineWidth = W(2);
            ctx.beginPath(); ctx.arc(sig.x, sig.y, sz * (0.95 + 0.25 * pulse), 0, Math.PI * 2); ctx.stroke();
          }
        }
        ctx.fillStyle = LOS_COLORS[los];
        ctx.beginPath();
        ctx.roundRect(sig.x - sz / 2, sig.y - sz / 2, sz, sz, W(3));
        ctx.fill();
        if (sig.featured) { ctx.strokeStyle = "#FBBF24"; ctx.lineWidth = W(2); ctx.stroke(); }
        ctx.fillStyle = los === "F" ? "#FFFFFF" : "#0B1220";
        ctx.fillText(los, sig.x, sig.y + W(0.5));
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** Camera fly between two framings: zooms out through the middle when the hop is long. */
export function flyCamera(a: Camera, b: Camera, t: number, vw: number, vh: number): Camera {
  const u = ease(t);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sMid = Math.min(a.s, b.s, (Math.min(vw, vh) * 0.7) / Math.max(1, dist + 1200));
  const s = t < 0.5
    ? Math.exp(lerp(Math.log(a.s), Math.log(sMid), ease(t * 2)))
    : Math.exp(lerp(Math.log(sMid), Math.log(b.s), ease(t * 2 - 1)));
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), s };
}

export function zoomCamera(a: Camera, b: Camera, t: number): Camera {
  const u = ease(t);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), u)) };
}
