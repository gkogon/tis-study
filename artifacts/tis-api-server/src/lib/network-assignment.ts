/**
 * Step 4 — Route Assignment over the actual road network.
 *
 * The per-signal gravity+BPR step answers "how many project trips reach
 * each signal." This module answers "which roads carry them": it builds a
 * routing graph from the local OSM road network, finds the shortest path
 * from the site to each destination signal, loads the project trips onto
 * the links of those paths, and runs a capacity-constrained equilibrium
 * (BPR volume-delay + Method of Successive Averages) so congested links
 * push trips toward alternate routes.
 *
 * Bounded + best-effort: the road subgraph is limited to the study radius
 * (served by the analyzer's /roads endpoint), and the caller falls back to
 * the gravity assignment when road data isn't available. The per-signal
 * trip totals are unchanged — this layer adds the corridor loading and
 * link-level v/c that a reviewer expects from a route-assignment step.
 */
import { bprTime } from "./four-step-model";

const ANALYZER_BASE_URL = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

type RoadSegment = [number, number, number, number, number, number | null, number | null];

export type RouteDestination = { lat: number; lon: number; trips: number };

export type CorridorClass = {
  classLabel: string;
  projectVph: number;   // project trips assigned to this road class
  lengthMi: number;     // total loaded length in this class
  vOverC: number;       // volume-weighted mean v/c of loaded links
};

export type RouteAssignment = {
  available: boolean;
  method: string;
  iterations: number;
  destinationsTotal: number;
  destinationsRouted: number;   // had a path through the network
  onNetworkPct: number;
  worstLinkVoverC: number;
  corridors: CorridorClass[];   // by road class, descending project volume
};

const CLASS_LABEL = ["Freeway / motorway", "Trunk highway", "Principal arterial", "Minor arterial", "Collector"];
const CLASS_FREE_MPH = [60, 50, 40, 30, 25];       // free-flow speed by class
const CLASS_LANES_PER_DIR = [3, 2, 2, 1, 1];        // default lanes/dir when OSM lanes missing
const PER_LANE_CAP_VPH = 1900;                      // HCM-ish per-lane capacity
// Typical existing PM-peak utilization by functional class (screening
// proxy). Without per-link background counts, this seeds each link's v/c so
// the BPR equilibrium genuinely shifts project trips toward the less-
// utilized classes/links instead of being inert on empty roads.
const CLASS_BASE_VC = [0.75, 0.70, 0.62, 0.52, 0.42];

/** Fetch the bounded local road network from the analyzer. null on failure. */
export async function fetchLocalRoads(
  regionCode: string, lat: number, lon: number, radiusMi: number,
): Promise<RoadSegment[] | null> {
  try {
    const url = `${ANALYZER_BASE_URL}/api/roads?regionCode=${encodeURIComponent(regionCode)}`
      + `&lat=${lat}&lon=${lon}&radiusMi=${Math.max(0.5, radiusMi + 0.25)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const data = (await r.json()) as { available?: boolean; segments?: RoadSegment[] };
    if (!data.available || !Array.isArray(data.segments) || data.segments.length === 0) return null;
    return data.segments;
  } catch {
    return null;
  }
}

function distMi(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 3958.8;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type Link = { a: number; b: number; lenMi: number; freeMin: number; capVph: number; cls: number; baseVc: number; vol: number };

/**
 * Build the graph, run an MSA user-equilibrium assignment of the
 * destinations' trips from the site, and summarize the loaded corridors.
 */
export function assignRoutes(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  opts: { iterations?: number } = {},
): RouteAssignment {
  const iterations = opts.iterations ?? 4;
  const empty: RouteAssignment = {
    available: false, method: "network shortest-path + BPR (MSA)", iterations: 0,
    destinationsTotal: destinations.length, destinationsRouted: 0, onNetworkPct: 0,
    worstLinkVoverC: 0, corridors: [],
  };
  if (segments.length === 0 || destinations.length === 0) return empty;

  // --- Build graph: nodes keyed by 5-dp coord; links from segments. ---
  const nodeIdx = new Map<string, number>();
  const nodeLat: number[] = [];
  const nodeLon: number[] = [];
  const key = (la: number, lo: number) => `${la.toFixed(5)},${lo.toFixed(5)}`;
  const nodeOf = (la: number, lo: number): number => {
    const k = key(la, lo);
    let i = nodeIdx.get(k);
    if (i === undefined) { i = nodeLat.length; nodeIdx.set(k, i); nodeLat.push(la); nodeLon.push(lo); }
    return i;
  };
  const links: Link[] = [];
  const adj: number[][] = []; // node → link indices (undirected: traverse either way)
  const addAdj = (n: number, li: number) => { (adj[n] ??= []).push(li); };
  for (const s of segments) {
    const cls = Math.min(4, Math.max(0, s[0]));
    const a = nodeOf(s[1], s[2]);
    const b = nodeOf(s[3], s[4]);
    if (a === b) continue;
    const lenMi = distMi(s[1], s[2], s[3], s[4]);
    if (lenMi <= 0) continue;
    const mph = (typeof s[6] === "number" && s[6]! > 0) ? s[6]! : CLASS_FREE_MPH[cls]!;
    const lanesPerDir = (typeof s[5] === "number" && s[5]! > 0) ? Math.max(1, Math.round(s[5]! / 2)) : CLASS_LANES_PER_DIR[cls]!;
    const li = links.length;
    links.push({ a, b, lenMi, freeMin: (lenMi / mph) * 60, capVph: lanesPerDir * PER_LANE_CAP_VPH, cls, baseVc: CLASS_BASE_VC[cls] ?? 0.5, vol: 0 });
    addAdj(a, li); addAdj(b, li);
  }
  if (links.length === 0) return empty;

  // Snap site + destinations to nearest node (scan — graph is bounded).
  const nearestNode = (la: number, lo: number): number => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodeLat.length; i++) {
      const d = distMi(la, lo, nodeLat[i]!, nodeLon[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const siteNode = nearestNode(site.lat, site.lon);
  const destNodes = destinations.map((d) => ({ node: nearestNode(d.lat, d.lon), trips: d.trips }));

  // Dijkstra from the site over current congested link times → shortest-
  // path tree (predecessor link per node). Returns dist[] + predLink[].
  // Congested time uses total v/c = existing utilization (class baseline) +
  // the project trips loaded onto the link so far.
  const linkTime = (li: number) => bprTime(links[li]!.freeMin, links[li]!.baseVc + links[li]!.vol / links[li]!.capVph);
  function dijkstra(): { pred: number[] } {
    const n = nodeLat.length;
    const dist = new Array<number>(n).fill(Infinity);
    const pred = new Array<number>(n).fill(-1);
    const done = new Array<boolean>(n).fill(false);
    dist[siteNode] = 0;
    // Simple O(n^2) selection — n is small (bounded radius).
    for (let it = 0; it < n; it++) {
      let u = -1, ud = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < ud) { ud = dist[i]!; u = i; }
      if (u === -1) break;
      done[u] = true;
      for (const li of adj[u] ?? []) {
        const lk = links[li]!;
        const v = lk.a === u ? lk.b : lk.a;
        const nd = ud + linkTime(li);
        if (nd < dist[v]!) { dist[v] = nd; pred[v] = li; }
      }
    }
    return { pred };
  }

  // MSA: each iteration computes an all-or-nothing auxiliary loading on
  // current times, then blends vol = (1-φ)·vol + φ·aux, φ = 1/(iter+1).
  let routed = 0;
  for (let iter = 0; iter < iterations; iter++) {
    const { pred } = dijkstra();
    const aux = new Array<number>(links.length).fill(0);
    routed = 0;
    for (const d of destNodes) {
      if (d.node < 0 || pred[d.node] === -1 && d.node !== siteNode) continue;
      let cur = d.node, guard = 0;
      let reached = cur === siteNode;
      while (cur !== siteNode && guard++ < 5000) {
        const li = pred[cur];
        if (li === undefined || li === -1) break;
        aux[li]! += d.trips;
        const lk = links[li]!;
        cur = lk.a === cur ? lk.b : lk.a;
        if (cur === siteNode) reached = true;
      }
      if (reached) routed++;
    }
    const phi = 1 / (iter + 1);
    for (let li = 0; li < links.length; li++) links[li]!.vol = (1 - phi) * links[li]!.vol + phi * aux[li]!;
  }

  // Summarize loaded corridors by road class. projectVph = the PEAK single-
  // link project flow in the class (a representative corridor flow, not the
  // inflated sum across every link); vOverC = the peak total v/c (existing
  // utilization + project) on a loaded link of that class.
  const byClass = new Map<number, { peakVph: number; len: number; peakVc: number }>();
  let worstVc = 0;
  for (const lk of links) {
    if (lk.vol < 0.5) continue;
    const totalVc = lk.baseVc + lk.vol / lk.capVph;
    if (totalVc > worstVc) worstVc = totalVc;
    const g = byClass.get(lk.cls) ?? { peakVph: 0, len: 0, peakVc: 0 };
    g.peakVph = Math.max(g.peakVph, lk.vol);
    g.len += lk.lenMi;
    g.peakVc = Math.max(g.peakVc, totalVc);
    byClass.set(lk.cls, g);
  }
  const corridors: CorridorClass[] = [...byClass.entries()]
    .map(([cls, g]) => ({
      classLabel: CLASS_LABEL[cls] ?? `Class ${cls}`,
      projectVph: Math.round(g.peakVph),
      lengthMi: Math.round(g.len * 100) / 100,
      vOverC: Math.round(g.peakVc * 1000) / 1000,
    }))
    .filter((c) => c.projectVph > 0)
    .sort((a, b) => b.projectVph - a.projectVph);

  return {
    available: true,
    method: "network shortest-path + BPR volume-delay (MSA equilibrium)",
    iterations,
    destinationsTotal: destinations.length,
    destinationsRouted: routed,
    onNetworkPct: Math.round((routed / Math.max(1, destinations.length)) * 1000) / 10,
    worstLinkVoverC: Math.round(worstVc * 1000) / 1000,
    corridors,
  };
}
