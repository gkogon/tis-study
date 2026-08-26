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
import { classifyMovement, sideOfStreet, resolveMovements, maskOneWayMovements, type Driveway } from "./driveways.ts";

const ANALYZER_BASE_URL = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

export type RoadSegment = [
  number, number, number, number, number,
  number | null, number | null,
  /** Street name; null on unnamed ways, absent on old payloads. Carried for
   *  consumers/diagnostics — buildGraph does not read it. */
  (string | null)?,
  /** 1 = a->b only, -1 = b->a only, 0/absent = two-way. */
  (number | null)?,
];

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

/**
 * One turning movement's worth of assigned flow, in graph terms.
 * `node` is the junction; `inLink`/`outLink` are link indices into the graph
 * the assignment was run on. Geometry (approach + L/T/R) is derived later —
 * this layer stays purely topological so the conservation proof is about
 * numbers, not about compass bearings.
 */
export type TurnFlow = { node: number; inLink: number; outLink: number; trips: number };

/** Diagnostic for the node-balance invariant. */
export type ConservationReport = {
  /** Interior nodes where at least one turn was recorded. */
  nodesChecked: number;
  /** Largest |Σ entering − Σ leaving| over those nodes, in trips. */
  maxImbalance: number;
  /** True when every checked node balances within tolerance. */
  balanced: boolean;
};

function turnKey(node: number, inLink: number, outLink: number): string {
  return `${node}|${inLink}|${outLink}`;
}

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

/**
 * `dir` is the one-way constraint from OSM (RoadSegment[8]):
 *   0 = two-way, 1 = a→b only, -1 = b→a only.
 * Enforced at ADJACENCY-BUILD time, so Dijkstra, the MSA loading, the turn
 * ledger and the driveway router all inherit it without any of them knowing
 * one-way exists: a forbidden direction simply is not an edge.
 */
export type Link = { a: number; b: number; lenMi: number; freeMin: number; capVph: number; cls: number; baseVc: number; vol: number; dir: 0 | 1 | -1 };

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
    // One-way capture (RoadSegment[8], present on post-2026-08 road files).
    // Absent or 0 = two-way, which is exactly the old behaviour — so every
    // pre-rollout region routes byte-identically.
    const rawDir: unknown = s[8];
    const dir: 0 | 1 | -1 = rawDir === 1 ? 1 : rawDir === -1 ? -1 : 0;
    links.push({ a, b, lenMi, freeMin: (lenMi / mph) * 60, capVph, cls, baseVc, vol: 0, dir });
    // Travelling a→b is legal unless the way is b→a-only, and vice versa. A
    // one-way link appears in ONE node's adjacency, so the router cannot even
    // consider the illegal direction — no penalty tuning, no special cases in
    // Dijkstra, the backward walk, or the driveway insertion.
    if (dir !== -1) addAdj(a, li);
    if (dir !== 1) addAdj(b, li);
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

/**
 * Directed reachability from `rootNode`: which nodes the root can legally
 * reach (`outbound`, over the forward adjacency the graph already enforces)
 * and which nodes can legally reach the root (`inbound`, over the transpose —
 * the same transposition the inbound routing pass uses). Plain BFS: this is a
 * connectivity screen, costs don't matter.
 *
 * Exists for cordon-gateway screening on one-way-bearing graphs: a gateway
 * with no legal path in EITHER direction never routes — its demand share
 * silently evaporates at the pred=-1 skip, deflating routed/onNetworkPct and
 * every resolved intersection's weight with no diagnostic. Callers drop such
 * gateways and renormalize BEFORE routing. On all-two-way graphs outbound and
 * inbound are identical (undirected connectivity), and callers must not
 * change behaviour there — today's shipped regions carry no one-way links.
 */
export function directedReachability(g: Graph, rootNode: number): { outbound: Uint8Array; inbound: Uint8Array } {
  const n = g.nodeLat.length;
  // Transpose: a link relaxable FROM u in the forward graph is relaxable
  // from its other endpoint here (legal head), exactly as in the inbound
  // routing pass of assignRoutesWithTurns.
  const radj: number[][] = [];
  for (let li = 0; li < g.links.length; li++) {
    const lk = g.links[li]!;
    if (lk.dir !== -1) (radj[lk.b] ??= []).push(li);
    if (lk.dir !== 1) (radj[lk.a] ??= []).push(li);
  }
  const bfs = (adjL: number[][]): Uint8Array => {
    const seen = new Uint8Array(n);
    if (rootNode < 0 || rootNode >= n) return seen;
    const queue: number[] = [rootNode];
    seen[rootNode] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi]!;
      for (const li of adjL[u] ?? []) {
        const lk = g.links[li]!;
        const v = lk.a === u ? lk.b : lk.a;
        if (!seen[v]) { seen[v] = 1; queue.push(v); }
      }
    }
    return seen;
  };
  return { outbound: bfs(g.adj), inbound: bfs(radj) };
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

/** Split the nearest link at the driveway's snap point; add a site→driveway access link.
 *  `streetDir` is the fronting street's one-way flag relative to `streetBearing`
 *  (1 = travel only along the bearing, -1 = only against it, 0 = two-way), so
 *  the movement layer can mask turns the one-way street makes impossible. */
export function insertDriveway(g: Graph, siteNode: number, lat: number, lon: number): { drivewayNode: number; accessLink: number; streetBearing: number; streetDir: 0 | 1 | -1 } {
  const snap = nearestLinkPoint(g, lat, lon);
  const addAdj = (n: number, li: number) => { (g.adj[n] ??= []).push(li); };
  if (snap.li < 0) {
    // No links: connect the driveway directly to the site.
    const dn = g.nodeOf(snap.lat, snap.lon);
    const al = g.links.length;
    g.links.push({ a: siteNode, b: dn, lenMi: 0.02, freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0, dir: 0 });
    addAdj(siteNode, al); addAdj(dn, al);
    return { drivewayNode: dn, accessLink: al, streetBearing: 0, streetDir: 0 };
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
  // Direction-aware rewiring: on a one-way a→b street (dir=1), travel dn→a and
  // b→dn are illegal, so those adjacency entries must not exist — otherwise the
  // driveway split would quietly re-open the forbidden direction on both halves.
  if (orig.dir !== 1) addAdj(dn, snap.li);   // dn→a legal unless a→b-only
  if (orig.dir !== -1) addAdj(dn, bLink);    // dn→b legal unless b→a-only
  if (orig.dir !== 1) addAdj(orig.b, bLink); // b→dn legal unless a→b-only
  // Access link site→driveway (short, high-capacity, uncongested).
  const al = g.links.length;
  g.links.push({ a: siteNode, b: dn, lenMi: Math.max(0.01, distMi(g.nodeLat[siteNode]!, g.nodeLon[siteNode]!, snap.lat, snap.lon)), freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0, dir: 0 });
  addAdj(siteNode, al); addAdj(dn, al);
  return { drivewayNode: dn, accessLink: al, streetBearing, streetDir: orig.dir };
}

/**
 * Build the graph, run an MSA user-equilibrium assignment of the
 * destinations' trips from the site, and summarize the loaded corridors.
 */
/** What the assignment produces once the turn attribution is kept. */
export type RoutedNetwork = {
  assignment: RouteAssignment;
  /** Every turn carrying flow, at every interior node the paths pass through. */
  turns: TurnFlow[];
  conservation: ConservationReport;
  /**
   * Inbound (gateway→site) turn ledger, present ONLY when the graph carries at
   * least one one-way link. On an all-two-way graph the historical inbound
   * mirror (reverse every outbound turn) IS the legal return path, so this
   * stays undefined and downstream output is bit-for-bit unchanged. With
   * one-way links the mirror can imply wrong-way travel, so the return
   * direction is routed for real on the transposed graph and recorded here in
   * travel-toward-site orientation (enter node on inLink, leave on outLink).
   */
  turnsInbound?: TurnFlow[];
};

/**
 * `assignRoutes` returns only the road-class summary and is what the report
 * payload has always carried — its output is untouched by the turn ledger.
 * Callers that need the movement attribution use `assignRoutesWithTurns`.
 */
export function assignRoutes(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  opts: { iterations?: number; volumeRefs?: VolumeRef[] } = {},
): RouteAssignment {
  return assignRoutesWithTurns(site, destinations, segments, opts).assignment;
}

export function assignRoutesWithTurns(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  opts: { iterations?: number; volumeRefs?: VolumeRef[] } = {},
): RoutedNetwork {
  const volumeRefs = opts.volumeRefs ?? [];
  const iterations = opts.iterations ?? 4;
  const empty: RouteAssignment = {
    available: false, method: "network shortest-path + BPR (MSA)", iterations: 0,
    destinationsTotal: destinations.length, destinationsRouted: 0, onNetworkPct: 0,
    worstLinkVoverC: 0, corridors: [],
  };
  const emptyNet: RoutedNetwork = {
    assignment: empty, turns: [],
    conservation: { nodesChecked: 0, maxImbalance: 0, balanced: true },
  };
  if (segments.length === 0 || destinations.length === 0) return emptyNet;

  // --- Build graph using the shared buildGraph helper. ---
  const g = buildGraph(segments, volumeRefs);
  const { links, adj, nodeLat, nodeLon } = g;
  if (links.length === 0) return emptyNet;

  // Snap site + destinations to nearest node (scan — graph is bounded).
  const siteNode = g.nearestNode(site.lat, site.lon);
  const destNodes = destinations.map((d) => ({ node: g.nearestNode(d.lat, d.lon), trips: d.trips }));

  // Dijkstra from the site over current congested link times → shortest-
  // path tree (predecessor link per node). Returns dist[] + predLink[].
  // Congested time uses total v/c = existing utilization (class baseline) +
  // the project trips loaded onto the link so far.
  const linkTime = (li: number) => bprTime(links[li]!.freeMin, links[li]!.baseVc + links[li]!.vol / links[li]!.capVph);

  // Turn ledger: `${node}|${inLink}|${outLink}` → blended trips making that
  // turn. This is the attribution the collapse at the end of this function has
  // always discarded — link flow was already conserved through nodes, only the
  // record of WHICH movement each vehicle made was thrown away.
  const turn = new Map<string, number>();
  const auxTurn = new Map<string, number>();
  // Site-rooted shortest-path tree over an arbitrary adjacency + link-time
  // function, so the outbound pass (forward adjacency, outbound loading) and
  // the inbound pass (transposed adjacency, its own loading) share one router.
  function dijkstra(adjL: number[][], timeOf: (li: number) => number): { pred: number[] } {
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
      for (const li of adjL[u] ?? []) {
        const lk = links[li]!;
        const v = lk.a === u ? lk.b : lk.a;
        const nd = ud + timeOf(li);
        if (nd < dist[v]!) { dist[v] = nd; pred[v] = li; }
      }
    }
    return { pred };
  }

  // MSA: each iteration computes an all-or-nothing auxiliary loading on
  // current times, then blends vol = (1-φ)·vol + φ·aux, φ = 1/(iter+1).
  let routed = 0;
  for (let iter = 0; iter < iterations; iter++) {
    const { pred } = dijkstra(adj, linkTime);
    const aux = new Array<number>(links.length).fill(0);
    // Must be cleared per iteration exactly like `aux` is re-allocated: this is
    // an all-or-nothing loading for THIS iteration's shortest-path tree, not a
    // running total. Letting it accumulate would blend each iteration against
    // the sum of all previous ones and quietly break conservation.
    auxTurn.clear();
    routed = 0;
    for (const d of destNodes) {
      if (d.node < 0 || pred[d.node] === -1 && d.node !== siteNode) continue;
      let cur = d.node, guard = 0;
      let reached = cur === siteNode;
      // `outLi` is the link walked on the PREVIOUS hop. Walking backwards from
      // the destination, at node `cur` the vehicle travelling site→dest enters
      // on pred[cur] and leaves on that previously-walked link — which is the
      // (in-link, node, out-link) triple a turning movement is made of. The
      // walk already visits it; nothing extra has to be computed or stored to
      // find it. At the destination itself outLi is -1: a terminus has no turn.
      let outLi = -1;
      while (cur !== siteNode && guard++ < 5000) {
        const li = pred[cur];
        if (li === undefined || li === -1) break;
        aux[li]! += d.trips;
        if (outLi !== -1) {
          const k = turnKey(cur, li, outLi);
          auxTurn.set(k, (auxTurn.get(k) ?? 0) + d.trips);
        }
        outLi = li;
        const lk = links[li]!;
        cur = lk.a === cur ? lk.b : lk.a;
        if (cur === siteNode) reached = true;
      }
      if (reached) routed++;
    }
    const phi = 1 / (iter + 1);
    for (let li = 0; li < links.length; li++) links[li]!.vol = (1 - phi) * links[li]!.vol + phi * aux[li]!;
    // Blend the turn ledger with the SAME φ, over the union of both key sets.
    // Using the identical blend is what keeps the ledger consistent with `vol`:
    // both are linear combinations of the same all-or-nothing loadings, so
    // Σ(turns entering v on e) === (flow on e directed at v) holds at every
    // iteration, not just at convergence. Keys absent from one side count as 0.
    for (const k of new Set([...turn.keys(), ...auxTurn.keys()])) {
      const blended = (1 - phi) * (turn.get(k) ?? 0) + phi * (auxTurn.get(k) ?? 0);
      if (blended > 1e-9) turn.set(k, blended);
      else turn.delete(k);
    }
  }

  // --- Inbound (return-direction) pass — one-way graphs ONLY. --------------
  // Downstream movement attribution historically fabricated inbound turns by
  // mirroring the outbound ledger. On an all-two-way graph the mirror IS the
  // legal return path, and reverse-Dijkstra tie-breaking could pick different
  // equal-cost trees than the mirror, so two-way graphs skip this block
  // entirely (turnsInbound stays undefined ⇒ downstream bit-for-bit
  // unchanged). With one-way links the mirror can imply wrong-way travel —
  // the exact violation this module exists to prevent — so the return legs
  // are routed for real: the same site-rooted Dijkstra/MSA over the
  // TRANSPOSED adjacency (each link relaxable from its legal HEAD), whose
  // shortest-path tree is exactly the set of legal gateway→site paths.
  // Walking that tree from a gateway visits nodes in true travel order, so
  // the ledger records (node, inLink, outLink) in travel-toward-site
  // orientation directly — no mirroring anywhere. The pass keeps its own
  // loading (volIn) for congestion feedback and never touches links[].vol,
  // so the RouteAssignment summary (corridors, v/c) is unchanged.
  let turnsInbound: TurnFlow[] | undefined;
  if (links.some((lk) => lk.dir !== 0)) {
    const radj: number[][] = [];
    const addRadj = (n: number, li: number) => { (radj[n] ??= []).push(li); };
    for (let li = 0; li < links.length; li++) {
      const lk = links[li]!;
      // Transposition: forward a→b legal (dir ≠ -1) ⇒ reverse-relaxable from b;
      // forward b→a legal (dir ≠ 1) ⇒ reverse-relaxable from a.
      if (lk.dir !== -1) addRadj(lk.b, li);
      if (lk.dir !== 1) addRadj(lk.a, li);
    }
    const volIn = new Array<number>(links.length).fill(0);
    const timeIn = (li: number) =>
      bprTime(links[li]!.freeMin, links[li]!.baseVc + volIn[li]! / links[li]!.capVph);
    const turnIn = new Map<string, number>();
    const auxTurnIn = new Map<string, number>();
    for (let iter = 0; iter < iterations; iter++) {
      const { pred } = dijkstra(radj, timeIn);
      const aux = new Array<number>(links.length).fill(0);
      auxTurnIn.clear();
      for (const d of destNodes) {
        if (d.node < 0 || pred[d.node] === -1 && d.node !== siteNode) continue;
        // pred[] is the site-rooted tree on the transposed graph, so walking
        // it from the gateway follows the REAL inbound path in forward travel
        // order: the vehicle enters `cur` on the previous hop's link and
        // leaves it on pred[cur]. At the gateway itself there is no previous
        // hop (an origin has no turn); the site is a terminus (walk ends).
        let cur = d.node, guard = 0;
        let inLi = -1;
        while (cur !== siteNode && guard++ < 5000) {
          const li = pred[cur];
          if (li === undefined || li === -1) break;
          aux[li]! += d.trips;
          if (inLi !== -1) {
            const k = turnKey(cur, inLi, li);
            auxTurnIn.set(k, (auxTurnIn.get(k) ?? 0) + d.trips);
          }
          inLi = li;
          const lk = links[li]!;
          cur = lk.a === cur ? lk.b : lk.a;
        }
      }
      const phi = 1 / (iter + 1);
      for (let li = 0; li < links.length; li++) volIn[li] = (1 - phi) * volIn[li]! + phi * aux[li]!;
      for (const k of new Set([...turnIn.keys(), ...auxTurnIn.keys()])) {
        const blended = (1 - phi) * (turnIn.get(k) ?? 0) + phi * (auxTurnIn.get(k) ?? 0);
        if (blended > 1e-9) turnIn.set(k, blended);
        else turnIn.delete(k);
      }
    }
    turnsInbound = [];
    for (const [k, trips] of turnIn) {
      const [nodeStr, inStr, outStr] = k.split("|");
      turnsInbound.push({ node: Number(nodeStr), inLink: Number(inStr), outLink: Number(outStr), trips });
    }
    turnsInbound.sort((x, y) => x.node - y.node || x.inLink - y.inLink || x.outLink - y.outLink);
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

  // Materialise the ledger and check the node-balance invariant it exists to
  // provide. Flow through a junction must balance: everything that enters on
  // some link leaves on some link. This is the property the per-intersection
  // model cannot have, because it loads every intersection independently from
  // one global octant vector and never asks where the trips went next.
  const turns: TurnFlow[] = [];
  const enterByNode = new Map<number, number>();
  const leaveByNode = new Map<number, number>();
  for (const [k, trips] of turn) {
    const [nodeStr, inStr, outStr] = k.split("|");
    const node = Number(nodeStr), inLink = Number(inStr), outLink = Number(outStr);
    turns.push({ node, inLink, outLink, trips });
    enterByNode.set(node, (enterByNode.get(node) ?? 0) + trips);
    leaveByNode.set(node, (leaveByNode.get(node) ?? 0) + trips);
  }
  // Deterministic order: the Map's insertion order depends on which paths were
  // walked first, which depends on destination order. Sorting makes the output
  // a pure function of the inputs so two identical runs are byte-identical.
  turns.sort((x, y) => x.node - y.node || x.inLink - y.inLink || x.outLink - y.outLink);

  let maxImbalance = 0;
  for (const [node, entered] of enterByNode) {
    const left = leaveByNode.get(node) ?? 0;
    maxImbalance = Math.max(maxImbalance, Math.abs(entered - left));
  }
  const conservation: ConservationReport = {
    nodesChecked: enterByNode.size,
    maxImbalance: Math.round(maxImbalance * 1e6) / 1e6,
    balanced: maxImbalance <= 1e-6,
  };

  return {
    assignment: {
      available: true,
      method: "network shortest-path + BPR volume-delay (MSA equilibrium)",
      iterations,
      destinationsTotal: destinations.length,
      destinationsRouted: routed,
      onNetworkPct: Math.round((routed / Math.max(1, destinations.length)) * 1000) / 10,
      worstLinkVoverC: Math.round(worstVc * 1000) / 1000,
      corridors,
    },
    turns,
    conservation,
    ...(turnsInbound ? { turnsInbound } : {}),
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

/**
 * Auto-detect candidate driveway access points on the streets fronting a site.
 * Snaps the site to the nearest point on each nearby road segment, then greedily
 * accepts points that sit at a distinct BEARING from the site — so several
 * segments of one street (or parallel streets farther out) collapse to a single
 * frontage candidate, while genuinely different fronting streets (e.g. a corner
 * lot's two streets) each yield one. Street names aren't in the road data, so
 * labels are generic ("Driveway A/B/…"); every candidate defaults to full access
 * and the user repositions / edits / deletes. Returns [] when no roads are near.
 */
export function findDrivewayCandidates(
  segments: RoadSegment[],
  site: { lat: number; lon: number },
  opts: { maxCandidates?: number; maxDistMi?: number; minSepDeg?: number } = {},
): Driveway[] {
  const maxCandidates = opts.maxCandidates ?? 4;
  const maxDistMi = opts.maxDistMi ?? 0.12;
  const minSepDeg = opts.minSepDeg ?? 30;
  if (segments.length === 0) return [];
  const g = buildGraph(segments, []);
  if (g.links.length === 0) return [];
  const bearing = (lat: number, lon: number): number => {
    const φ1 = (site.lat * Math.PI) / 180, φ2 = (lat * Math.PI) / 180;
    const Δλ = ((lon - site.lon) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const pts: { lat: number; lon: number; distMi: number; brg: number }[] = [];
  for (let li = 0; li < g.links.length; li++) {
    const lk = g.links[li]!;
    const ax = g.nodeLon[lk.a]!, ay = g.nodeLat[lk.a]!, bx = g.nodeLon[lk.b]!, by = g.nodeLat[lk.b]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((site.lon - ax) * dx + (site.lat - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const plat = ay + t * dy, plon = ax + t * dx;
    pts.push({ lat: plat, lon: plon, distMi: distMi(site.lat, site.lon, plat, plon), brg: bearing(plat, plon) });
  }
  pts.sort((a, b) => a.distMi - b.distMi);
  const accepted: { lat: number; lon: number }[] = [];
  const acceptedBrg: number[] = [];
  for (const p of pts) {
    if (p.distMi > maxDistMi) break;
    const clash = acceptedBrg.some((q) => {
      let d = Math.abs(p.brg - q) % 360;
      if (d > 180) d = 360 - d;
      return d < minSepDeg;
    });
    if (clash) continue;
    accepted.push({ lat: p.lat, lon: p.lon });
    acceptedBrg.push(p.brg);
    if (accepted.length >= maxCandidates) break;
  }
  const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const LETTERS = "ABCDEFGHIJKL";
  return accepted.map((p, i) => ({
    id: `dw-${i + 1}`,
    latitude: round4(p.lat),
    longitude: round4(p.lon),
    label: `Driveway ${LETTERS[i] ?? String(i + 1)}`,
    accessType: "full",
    movements: { inLeft: true, inRight: true, outLeft: true, outRight: true },
  }));
}

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
    const { drivewayNode, streetBearing, streetDir } = insertDriveway(g, siteNode, d.latitude, d.longitude);
    const drivewayToSite = bearingBetween(d.latitude, d.longitude, site.lat, site.lon);
    const side = sideOfStreet(streetBearing, drivewayToSite);
    // One-way fronting street: mask the movements the street makes physically
    // impossible (the pair whose along-street travel opposes the legal
    // direction), so no driveway is ever credited an enter/exit movement that
    // heads against traffic. streetDir is 0 on all two-way / pre-rollout data
    // ⇒ the mask is a no-op and the assignment is byte-identical.
    return { node: drivewayNode, label: d.label ?? d.id, streetBearing, side,
             mv: maskOneWayMovements(resolveMovements(d), side, streetDir),
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

    // A destination's directional demand splits evenly between the OUTBOUND
    // (departing) and INBOUND (arriving) legs. Both legs load the intersection
    // and either can be rerouted, so per-intersection LOS and the reroute
    // accounting reflect the full access picture. The even split keeps the
    // total project load conserved (Σ legs = d.trips) while normalization
    // downstream (dwShare) makes only the relative distribution matter.
    const legTrips = d.trips / 2;

    // Outbound leg: which driveways can serve a trip leaving toward this destination?
    const eligibleOut = dws.filter((dw) => {
      const mvNeeded = classifyMovement(dw.streetBearing, dw.side, odBearing, false); // "outLeft" | "outRight"
      return dw.mv[mvNeeded];
    });
    if (eligibleOut.length > 0) {
      // Nearest eligible driveway carries the outbound trip; count its exit movement.
      const dw = eligibleOut.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      const mv = classifyMovement(dw.streetBearing, dw.side, odBearing, false) as "outLeft" | "outRight";
      dw.exitByMovement[mv] += legTrips;
      perDest[i]! += legTrips;
    } else {
      // Outbound forbidden everywhere ⇒ reroute via the nearest driveway + U-turn.
      const dw = dws.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      dw.rerouted += legTrips;
      // The U-turn happens at the nearest downstream node to the driveway; its
      // added turning volume lands on the destination nearest that node.
      const uturnDest = nearestDestTo(dw.node);
      perDest[uturnDest]! += legTrips;
      reroutes.push({ destIndex: uturnDest, trips: legTrips });
    }

    // Inbound leg: which driveways can serve a trip arriving from this destination?
    // (vehicles travelling FROM odBearing TO the site — inbound = true)
    const eligibleIn = dws.filter((dw) => {
      const mvNeeded = classifyMovement(dw.streetBearing, dw.side, odBearing, true); // "inLeft" | "inRight"
      return dw.mv[mvNeeded];
    });
    if (eligibleIn.length > 0) {
      // Nearest eligible driveway carries the inbound trip; credit its enter
      // movement AND load the intersection (arrivals pass through it too).
      const dw = eligibleIn.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      const mv = classifyMovement(dw.streetBearing, dw.side, odBearing, true) as "inLeft" | "inRight";
      dw.enterByMovement[mv] += legTrips;
      perDest[i]! += legTrips;
    } else {
      // Inbound forbidden everywhere ⇒ the entering trip reroutes via a driveway
      // that allows ANY inbound movement (fallback: nearest), then U-turns.
      // Symmetric with the outbound branch: load LOS and record in reroutes[].
      const anyIn = dws.find((dw) => dw.mv.inLeft || dw.mv.inRight);
      const dw = anyIn ?? dws.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      dw.rerouted += legTrips;
      const uturnDest = nearestDestTo(dw.node);
      perDest[uturnDest]! += legTrips;
      reroutes.push({ destIndex: uturnDest, trips: legTrips });
    }
  }

  return {
    available: true,
    perDestinationAddedTrips: perDest,
    driveways: dws.map((dw) => ({ drivewayNode: dw.node, label: dw.label, enterByMovement: dw.enterByMovement, exitByMovement: dw.exitByMovement, reroutedTrips: dw.rerouted })),
    reroutes,
  };
}
