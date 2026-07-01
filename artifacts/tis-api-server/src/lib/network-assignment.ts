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
import { bprTime } from "./four-step-model.ts";
import { classifyMovement, sideOfStreet, resolveMovements, type Driveway } from "./driveways.ts";

const ANALYZER_BASE_URL = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

export type RoadSegment = [number, number, number, number, number, number | null, number | null];

export type RouteDestination = { lat: number; lon: number; trips: number };

/** Measured existing-volume reference point (a counted signal/segment). */
export type VolumeRef = { lat: number; lon: number; aadt: number };

const K_FACTOR = 0.09; // peak-hour fraction of AADT (screening default)

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

export type Link = { a: number; b: number; lenMi: number; freeMin: number; capVph: number; cls: number; baseVc: number; vol: number };

export type Graph = {
  links: Link[];
  adj: number[][];
  nodeLat: number[];
  nodeLon: number[];
  nodeOf: (la: number, lo: number) => number;
  nearestNode: (la: number, lo: number) => number;
};

export function buildGraph(segments: RoadSegment[], volumeRefs: VolumeRef[] = []): Graph {
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
  const seedBaseVc = (midLat: number, midLon: number, cls: number, capVph: number): number => {
    if (volumeRefs.length === 0) return CLASS_BASE_VC[cls] ?? 0.5;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < volumeRefs.length; i++) {
      const d = distMi(midLat, midLon, volumeRefs[i]!.lat, volumeRefs[i]!.lon);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > 0.6 || !(volumeRefs[best]!.aadt > 0)) return CLASS_BASE_VC[cls] ?? 0.5;
    const peakVph = volumeRefs[best]!.aadt * K_FACTOR;
    return Math.min(1.2, Math.max(0.15, peakVph / capVph));
  };
  const links: Link[] = [];
  const adj: number[][] = [];
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
    const capVph = lanesPerDir * PER_LANE_CAP_VPH;
    const baseVc = seedBaseVc((s[1] + s[3]) / 2, (s[2] + s[4]) / 2, cls, capVph);
    links.push({ a, b, lenMi, freeMin: (lenMi / mph) * 60, capVph, cls, baseVc, vol: 0 });
    addAdj(a, li); addAdj(b, li);
  }
  const nearestNode = (la: number, lo: number): number => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodeLat.length; i++) {
      const d = distMi(la, lo, nodeLat[i]!, nodeLon[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  return { links, adj, nodeLat, nodeLon, nodeOf, nearestNode };
}

/** Nearest point on any link to (lat,lon); t = fractional position a→b. */
export function nearestLinkPoint(g: Graph, lat: number, lon: number) {
  let best = { li: -1, t: 0, lat, lon, distMi: Infinity };
  for (let li = 0; li < g.links.length; li++) {
    const lk = g.links[li]!;
    const ax = g.nodeLon[lk.a]!, ay = g.nodeLat[lk.a]!, bx = g.nodeLon[lk.b]!, by = g.nodeLat[lk.b]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = distMi(lat, lon, py, px);
    if (d < best.distMi) best = { li, t, lat: py, lon: px, distMi: d };
  }
  return best;
}

/** Compass bearing (deg) from node `a` to node `b`. */
function nodeBearing(g: Graph, a: number, b: number): number {
  const φ1 = (g.nodeLat[a]! * Math.PI) / 180, φ2 = (g.nodeLat[b]! * Math.PI) / 180;
  const Δλ = ((g.nodeLon[b]! - g.nodeLon[a]!) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Split the nearest link at the driveway's snap point; add a site→driveway access link. */
export function insertDriveway(g: Graph, siteNode: number, lat: number, lon: number): { drivewayNode: number; accessLink: number; streetBearing: number } {
  const snap = nearestLinkPoint(g, lat, lon);
  const addAdj = (n: number, li: number) => { (g.adj[n] ??= []).push(li); };
  if (snap.li < 0) {
    // No links: connect the driveway directly to the site.
    const dn = g.nodeOf(snap.lat, snap.lon);
    const al = g.links.length;
    g.links.push({ a: siteNode, b: dn, lenMi: 0.02, freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0 });
    addAdj(siteNode, al); addAdj(dn, al);
    return { drivewayNode: dn, accessLink: al, streetBearing: 0 };
  }
  const orig = g.links[snap.li]!;
  const streetBearing = nodeBearing(g, orig.a, orig.b); // fronting-street bearing (capture before reshape)
  const dn = g.nodeOf(snap.lat, snap.lon);
  // Reshape the original link to a→dn; add a second link dn→b (split).
  const halfA = { ...orig, b: dn, lenMi: orig.lenMi * snap.t, freeMin: orig.freeMin * snap.t, vol: 0 };
  const halfB = { ...orig, a: dn, lenMi: orig.lenMi * (1 - snap.t), freeMin: orig.freeMin * (1 - snap.t), vol: 0 };
  g.links[snap.li] = halfA;                 // reuse the slot for a→dn
  const bLink = g.links.length; g.links.push(halfB);
  // orig.b previously had snap.li in its adjacency list; snap.li now goes a→dn
  // (no longer touches orig.b), so remove that stale entry.
  if (g.adj[orig.b]) g.adj[orig.b] = g.adj[orig.b].filter(li => li !== snap.li);
  addAdj(dn, snap.li); addAdj(dn, bLink); addAdj(orig.b, bLink);
  // Access link site→driveway (short, high-capacity, uncongested).
  const al = g.links.length;
  g.links.push({ a: siteNode, b: dn, lenMi: Math.max(0.01, distMi(g.nodeLat[siteNode]!, g.nodeLon[siteNode]!, snap.lat, snap.lon)), freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0 });
  addAdj(siteNode, al); addAdj(dn, al);
  return { drivewayNode: dn, accessLink: al, streetBearing };
}

/**
 * Build the graph, run an MSA user-equilibrium assignment of the
 * destinations' trips from the site, and summarize the loaded corridors.
 */
export function assignRoutes(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  opts: { iterations?: number; volumeRefs?: VolumeRef[] } = {},
): RouteAssignment {
  const volumeRefs = opts.volumeRefs ?? [];
  const iterations = opts.iterations ?? 4;
  const empty: RouteAssignment = {
    available: false, method: "network shortest-path + BPR (MSA)", iterations: 0,
    destinationsTotal: destinations.length, destinationsRouted: 0, onNetworkPct: 0,
    worstLinkVoverC: 0, corridors: [],
  };
  if (segments.length === 0 || destinations.length === 0) return empty;

  // --- Build graph using the shared buildGraph helper. ---
  const g = buildGraph(segments, volumeRefs);
  const { links, adj, nodeLat, nodeLon } = g;
  if (links.length === 0) return empty;

  // Snap site + destinations to nearest node (scan — graph is bounded).
  const siteNode = g.nearestNode(site.lat, site.lon);
  const destNodes = destinations.map((d) => ({ node: g.nearestNode(d.lat, d.lon), trips: d.trips }));

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

function bearingBetween(la1: number, lo1: number, la2: number, lo2: number): number {
  const φ1 = (la1 * Math.PI) / 180, φ2 = (la2 * Math.PI) / 180, Δλ = ((lo2 - lo1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export type DrivewayResult = {
  drivewayNode: number; label: string;
  enterByMovement: { inLeft: number; inRight: number };
  exitByMovement: { outLeft: number; outRight: number };
  reroutedTrips: number;
};
export type DrivewayAssignment = {
  available: boolean;
  perDestinationAddedTrips: number[];
  driveways: DrivewayResult[];
  reroutes: { destIndex: number; trips: number }[];
};

export function assignWithDriveways(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  driveways: Driveway[],
  opts: { volumeRefs?: VolumeRef[] } = {},
): DrivewayAssignment {
  const perDest = destinations.map(() => 0);
  const empty: DrivewayAssignment = { available: false, perDestinationAddedTrips: perDest, driveways: [], reroutes: [] };
  if (segments.length === 0 || destinations.length === 0 || driveways.length === 0) return empty;

  const g = buildGraph(segments, opts.volumeRefs ?? []);
  if (g.links.length === 0) return empty;
  const siteNode = g.nodeOf(site.lat, site.lon);

  // Insert driveways, capturing fronting-street bearing + site side per driveway.
  type DW = { node: number; label: string; streetBearing: number; side: 1 | -1; mv: ReturnType<typeof resolveMovements>;
             enterByMovement: { inLeft: number; inRight: number }; exitByMovement: { outLeft: number; outRight: number }; rerouted: number };
  const dws: DW[] = driveways.map((d) => {
    const { drivewayNode, streetBearing } = insertDriveway(g, siteNode, d.latitude, d.longitude);
    const drivewayToSite = bearingBetween(d.latitude, d.longitude, site.lat, site.lon);
    const side = sideOfStreet(streetBearing, drivewayToSite);
    return { node: drivewayNode, label: d.label ?? d.id, streetBearing, side, mv: resolveMovements(d),
             enterByMovement: { inLeft: 0, inRight: 0 }, exitByMovement: { outLeft: 0, outRight: 0 }, rerouted: 0 };
  });

  const nearestDestTo = (node: number): number => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < destinations.length; i++) {
      const d = distMi(g.nodeLat[node]!, g.nodeLon[node]!, destinations[i]!.lat, destinations[i]!.lon);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const reroutes: { destIndex: number; trips: number }[] = [];

  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i]!;
    const odBearing = bearingBetween(site.lat, site.lon, d.lat, d.lon);
    // Outbound leg: which driveways can serve a trip leaving toward this destination?
    const eligible = dws.filter((dw) => {
      const mvNeeded = classifyMovement(dw.streetBearing, dw.side, odBearing, false); // "outLeft" | "outRight"
      return dw.mv[mvNeeded];
    });
    if (eligible.length > 0) {
      // Nearest eligible driveway carries the trip; count its exit movement.
      const dw = eligible.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      const mv = classifyMovement(dw.streetBearing, dw.side, odBearing, false) as "outLeft" | "outRight";
      dw.exitByMovement[mv] += d.trips;
      perDest[i]! += d.trips;
    } else {
      // Forbidden everywhere ⇒ reroute via the nearest driveway + U-turn.
      const dw = dws.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      dw.rerouted += d.trips;
      // The U-turn happens at the nearest downstream node to the driveway; its
      // added turning volume lands on the destination nearest that node.
      const uturnDest = nearestDestTo(dw.node);
      perDest[uturnDest]! += d.trips;
      reroutes.push({ destIndex: uturnDest, trips: d.trips });
    }
  }

  return {
    available: true,
    perDestinationAddedTrips: perDest,
    driveways: dws.map((dw) => ({ drivewayNode: dw.node, label: dw.label, enterByMovement: dw.enterByMovement, exitByMovement: dw.exitByMovement, reroutedTrips: dw.rerouted })),
    reroutes,
  };
}
