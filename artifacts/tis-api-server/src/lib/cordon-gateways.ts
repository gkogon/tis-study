/**
 * Cordon gateways — real destinations for the route assignment.
 *
 * The engine's destinations have always been the study signals themselves
 * (tis.ts builds `dests` from the candidate list), which means every routed
 * path TERMINATES at a study intersection. A terminus has an arriving link and
 * no departing pair — exactly the turn we want to report — so no amount of
 * ledger-keeping can conserve flow through the place we care about. The
 * destinations, not the router, were the blocker.
 *
 * A cordon gateway is a node on the OUTER RING of the fetched road graph
 * (fetchLocalRoads pads the fetch to radiusMi + 0.25, so the ring exists by
 * construction). Trips run site → gateway and gateway → site, PASSING THROUGH
 * the studied intersections en route. Node balance Σin = Σout then holds at
 * every interior node, and the flow leaving intersection A on a link is
 * literally the same stored number arriving at intersection B.
 *
 * Gateways are weighted by the study's own §6.1 directional distribution
 * (dist.byDirection): octant k receives byDirection[k]% of the demand, split
 * over the octant's top three ring CROSSINGS (one gateway per crossing, see
 * ringPortals) by corridor importance (the total capacity of the gateway's
 * incident links, both directions of a two-way link). This is deliberate: the printed distribution section stays the
 * single source of truth for WHERE trips go, and the network only decides
 * WHICH ROADS carry them there — so the § "Trip Distribution" table and the
 * derived movements can never disagree about direction.
 *
 * Needs no Census/TAZ data, so it behaves identically in London, Tokyo,
 * Paris and Toronto — the national block-group TAZ layer is US-only and
 * returns nothing for most of the product's 315 regions.
 *
 * Everything here is a pure function of (graph, site, radius, byDirection):
 * no I/O, no randomness, no clock. Candidates are scanned in node-index
 * order and every tie-break is explicit, so two identical runs produce
 * byte-identical gateway sets — a hard requirement, since a flipped gateway
 * would swing every derived turning movement downstream.
 */
import type { Graph } from "./network-assignment.ts";
import { CARDINALS, bearingToCardinal, type CardinalDir } from "./caltran-gravity.ts";

/** One selected gateway with its share of unit demand. */
export type CordonGateway = {
  node: number;
  lat: number;
  lon: number;
  octant: CardinalDir;
  /** Fraction of total project demand leaving/entering through this node. Σ = 1. */
  share: number;
};

export type CordonSelection = {
  gateways: CordonGateway[];
  /** Octants that had demand but no gateway; their share moved to neighbours. */
  emptyOctants: CardinalDir[];
  /** Which class ceiling finally yielded a usable cordon (3, 4, or 99 = any). */
  classCeiling: number;
};

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((bLon - aLon) * p) * Math.cos(bLat * p);
  const x = Math.cos(aLat * p) * Math.sin(bLat * p)
    - Math.sin(aLat * p) * Math.cos(bLat * p) * Math.cos((bLon - aLon) * p);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distMi(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 3958.8;
  const p = Math.PI / 180;
  const s = Math.sin(((la2 - la1) * p) / 2) ** 2
    + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin(((lo2 - lo1) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Angular distance between two octants, in 45° steps (0..4). */
function octantSteps(a: CardinalDir, b: CardinalDir): number {
  const ia = CARDINALS.indexOf(a), ib = CARDINALS.indexOf(b);
  const d = Math.abs(ia - ib);
  return Math.min(d, 8 - d);
}

/**
 * Free-flow shortest-path tree from `root` over `adjL`, as each node's parent
 * plus the order nodes were settled in (a parent always settles before its
 * child). The heap orders by (time, node index) and a parent is replaced only
 * on a strictly shorter time, so equal-time ties resolve the same way on every
 * run.
 */
function freeFlowTree(g: Graph, adjL: number[][], root: number): { parent: Int32Array; order: number[] } {
  const n = g.nodeLat.length;
  const parent = new Int32Array(n).fill(-1);
  const order: number[] = [];
  if (root < 0 || root >= n) return { parent, order };
  const best = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  const hT: number[] = [], hN: number[] = [];
  const before = (i: number, j: number) => hT[i]! < hT[j]! || (hT[i] === hT[j] && hN[i]! < hN[j]!);
  const swap = (i: number, j: number) => {
    const t = hT[i]!, v = hN[i]!;
    hT[i] = hT[j]!; hN[i] = hN[j]!; hT[j] = t; hN[j] = v;
  };
  const push = (t: number, v: number) => {
    let i = hT.length;
    hT.push(t); hN.push(v);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!before(i, up)) break;
      swap(i, up); i = up;
    }
  };
  const pop = (): number => {
    const v = hN[0]!;
    const lastT = hT.pop()!, lastN = hN.pop()!;
    if (hT.length > 0) {
      hT[0] = lastT; hN[0] = lastN;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hT.length && before(l, m)) m = l;
        if (r < hT.length && before(r, m)) m = r;
        if (m === i) break;
        swap(i, m); i = m;
      }
    }
    return v;
  };
  best[root] = 0;
  push(0, root);
  while (hT.length > 0) {
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    order.push(u);
    for (const li of adjL[u] ?? []) {
      const lk = g.links[li]!;
      const v = lk.a === u ? lk.b : lk.a;
      const t = best[u]! + lk.freeMin;
      if (t < best[v]!) { best[v] = t; parent[v] = u; push(t, v); }
    }
  }
  return { parent, order };
}

/**
 * The ring crossing each node belongs to, as a node id (its "portal"), or -1
 * for nodes inside the ring.
 *
 * The portal of an outer node is where the site's free-flow shortest route to
 * it last leaves the circle: the first node outside the circle on that route.
 * Two gateways with the same portal share that route everywhere inside the
 * ring and differ only beyond it, so a second one adds almost nothing to the
 * study area's loading but takes a slot another corridor needed. Grouping by
 * portal therefore collapses a junction cluster,
 * the shape points of one road, and the nodes of a road further out along the
 * band, while two parallel roads that each have their own way out stay apart.
 *
 * Routes follow the forward (site → node) graph, the way the router's outbound
 * pass does. A node only reachable in the inbound direction uses its route to
 * the site instead; a node reachable neither way (a clipped fragment) takes the
 * lowest node index of its undirected component, so a fragment is one crossing.
 *
 * `dirs` records which passes can use each node as a gateway: 1 = the outbound
 * pass reaches it from the site, 2 = the inbound pass reaches the site from
 * it, 3 = both (every reachable node of an all-two-way graph), 0 = neither.
 */
function ringPortals(
  g: Graph, site: { lat: number; lon: number }, outside: Uint8Array,
): { portal: Int32Array; dirs: Uint8Array } {
  const n = g.nodeLat.length;
  const portal = new Int32Array(n).fill(-1);
  const dirs = new Uint8Array(n);
  const assigned = new Uint8Array(n);
  const root = g.nearestNode(site.lat, site.lon);
  const oneWay = g.links.some((lk) => lk.dir !== 0);
  const walk = (tree: { parent: Int32Array; order: number[] }, bits: number) => {
    const via = new Int32Array(n).fill(-1);
    for (const v of tree.order) {
      const u = tree.parent[v]!;
      via[v] = !outside[v] ? -1 : (u < 0 || !outside[u] ? v : via[u]!);
      dirs[v]! |= bits;
      if (!assigned[v]) { portal[v] = via[v]!; assigned[v] = 1; }
    }
  };
  walk(freeFlowTree(g, g.adj, root), oneWay ? 1 : 3);
  if (oneWay) {
    // Same transposition as directedReachability: a link relaxable from u in
    // the forward graph is relaxable from its other endpoint here.
    const radj: number[][] = [];
    for (let li = 0; li < g.links.length; li++) {
      const lk = g.links[li]!;
      if (lk.dir !== -1) (radj[lk.b] ??= []).push(li);
      if (lk.dir !== 1) (radj[lk.a] ??= []).push(li);
    }
    walk(freeFlowTree(g, radj, root), 2);
  }
  const both: number[][] = [];
  for (let li = 0; li < g.links.length; li++) {
    const lk = g.links[li]!;
    (both[lk.a] ??= []).push(li);
    (both[lk.b] ??= []).push(li);
  }
  for (let s = 0; s < n; s++) {
    if (assigned[s]) continue;
    const queue = [s];
    assigned[s] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi]!;
      portal[u] = outside[u] ? s : -1;
      for (const li of both[u] ?? []) {
        const lk = g.links[li]!;
        const v = lk.a === u ? lk.b : lk.a;
        if (!assigned[v]) { assigned[v] = 1; queue.push(v); }
      }
    }
  }
  return { portal, dirs };
}

/** Number of routing passes (outbound, inbound) a `dirs` mask serves. */
const passes = (d: number) => (d & 1) + ((d >> 1) & 1);

/**
 * Select the cordon for a study.
 *
 * @param g          graph built from the fetched segments (radius + 0.25 pad)
 * @param site       project site
 * @param radiusMi   the study radius the fetch was made for
 * @param byDirection the §6.1 directional distribution, percentages summing
 *                    to ~100 (the engine's rollup guarantees this)
 * @param routable   optional screen: a node it rejects is never a candidate.
 *                    tis.ts passes directed reachability from the site on
 *                    one-way-bearing graphs. Screening candidates, not the
 *                    finished selection, lets an octant whose best ring
 *                    crossing cannot route fall through to its next best;
 *                    dropping a selected gateway afterwards left its slot
 *                    empty and spread its share over every other octant.
 * @returns null when no usable cordon exists (caller keeps the legacy path)
 */
export function selectCordonGateways(
  g: Graph,
  site: { lat: number; lon: number },
  radiusMi: number,
  byDirection: Record<CardinalDir, number>,
  routable?: (node: number) => boolean,
): CordonSelection | null {
  const n = g.nodeLat.length;
  if (n === 0) return null;

  // --- Candidate ring -----------------------------------------------------
  // Outer ring = at or beyond the study radius (the fetch pads past it). The
  // 0.05 mi tolerance absorbs the radial truncation's soft edge.
  const RING_MIN = Math.max(0.05, radiusMi - 0.05);

  // Highest road class (lowest code) incident to each node, and the summed
  // capacity used as the within-octant importance weight. capVph is per
  // direction, so a two-way link counts it twice: the weight is the total
  // capacity of the node's links, and a one-way and a two-way road with the
  // same total lanes weigh the same. Counting capVph once let a 4-lane one-way
  // carriageway (7600) outrank a 4-lane two-way arterial (3800 each way) 2:1.
  const bestCls = new Array<number>(n).fill(99);
  const capSum = new Array<number>(n).fill(0);
  for (const lk of g.links) {
    if (lk.cls < bestCls[lk.a]!) bestCls[lk.a] = lk.cls;
    if (lk.cls < bestCls[lk.b]!) bestCls[lk.b] = lk.cls;
    const capTotal = lk.capVph * (lk.dir === 0 ? 2 : 1);
    capSum[lk.a]! += capTotal;
    capSum[lk.b]! += capTotal;
  }

  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (distMi(site.lat, site.lon, g.nodeLat[i]!, g.nodeLon[i]!) >= RING_MIN) outside[i] = 1;
  }
  const { portal, dirs } = ringPortals(g, site, outside);

  type Cand = { node: number; octant: CardinalDir; cap: number; portal: number; dirs: number };
  // Escalating class ceilings: prefer a cordon of real corridors (≤ secondary),
  // fall back to collectors, then to any boundary node. A cordon of service
  // alleys would route arterial traffic through them; better to relax only
  // when the stricter cordon genuinely does not exist.
  for (const ceiling of [3, 4, 99]) {
    const cands: Cand[] = [];
    for (let i = 0; i < n; i++) {
      if (bestCls[i]! > ceiling) continue;
      if (!outside[i]) continue;
      if (routable && !routable(i)) continue;
      cands.push({
        node: i,
        octant: bearingToCardinal(bearingDeg(site.lat, site.lon, g.nodeLat[i]!, g.nodeLon[i]!)),
        cap: capSum[i]!,
        portal: portal[i]!,
        dirs: dirs[i]!,
      });
    }
    // Fewer than 8 gateways is tolerable (a sparse ring still cordons); zero
    // is not — relax the class ceiling and try again.
    if (cands.length === 0) continue;

    // --- Demand per octant → gateways --------------------------------------
    const byOct = new Map<CardinalDir, Cand[]>();
    for (const c of cands) {
      const arr = byOct.get(c.octant) ?? [];
      arr.push(c);
      byOct.set(c.octant, arr);
    }

    const totalPct = CARDINALS.reduce((s, k) => s + (byDirection[k] ?? 0), 0);
    if (!(totalPct > 0)) return null;

    // Shares for octants with demand but no candidate move to the angularly
    // nearest non-empty octant(s); equidistant ones split equally. One pass,
    // deterministic, and it handles cascades (an empty neighbour is simply
    // never a target because targets must be non-empty).
    const nonEmpty = CARDINALS.filter((k) => (byOct.get(k)?.length ?? 0) > 0);
    if (nonEmpty.length === 0) continue;
    const emptyOctants: CardinalDir[] = [];
    const octShare = new Map<CardinalDir, number>();
    for (const k of CARDINALS) {
      const demand = (byDirection[k] ?? 0) / totalPct;
      if (demand <= 0) continue;
      if ((byOct.get(k)?.length ?? 0) > 0) {
        octShare.set(k, (octShare.get(k) ?? 0) + demand);
      } else {
        emptyOctants.push(k);
        const minSteps = Math.min(...nonEmpty.map((t) => octantSteps(k, t)));
        const targets = nonEmpty.filter((t) => octantSteps(k, t) === minSteps);
        for (const t of targets) {
          octShare.set(t, (octShare.get(t) ?? 0) + demand / targets.length);
        }
      }
    }

    // Within an octant: keep only the TOP-3 CROSSINGS by capacity, one gateway
    // each, then split the octant's share by capacity (evenly when capacities
    // are all 0).
    //
    // Without the cap, a dense urban ring yields hundreds of gateways (427
    // measured on the Miami corridor) and the demand smears into sub-vehicle
    // trickles on every residential stub that happens to cross the ring. Real
    // traffic leaves a study area on its arterials; concentrating each
    // octant's demand on its highest-capacity ring crossings is both the
    // defensible engineering assumption and what keeps the turn ledger's
    // flows large enough to survive integer rounding downstream.
    //
    // The cap counts crossings, not nodes. Ranked node by node, one crossing
    // took all three slots: a junction and the shape points either side of it
    // (three nodes within 21 m at the north end of McKnight Road, Pittsburgh,
    // NNW, which cost Perry Highway its gateway and all its trips) or the next
    // junctions out along the same road (City Road, London, NNW), and a
    // parallel corridor with its own way out lost its gateway and every trip.
    // So candidates are first collapsed to one per portal (ringPortals). A
    // crossing is represented by its highest-capacity node and weighs that
    // node's capacity, the same per-node measure as before, so an octant whose
    // top three nodes were already three separate roads splits exactly as it
    // did. Summing over a crossing's nodes was rejected: it would weigh a road
    // by how many shape points it has in the padding band, not by capacity.
    // A crossing is skipped too when its representative lies within
    // NODE_MERGE_M of one already taken (a junction whose legs reach the ring
    // separately arrives at different portals, but it is one place on the
    // map) or its portal within PORTAL_MERGE_M of one already taken (the two
    // carriageways of a divided road cross the ring side by side). The portal
    // radius is the tighter one because parallel streets one block apart also
    // cross the ring side by side: carriageway pairs on the measured sites
    // cross within 52 m, while Queen Victoria Street and Upper Thames Street,
    // two roads, cross the City of London ring 90 m apart.
    //
    // Direction (one-way graphs only; on an all-two-way graph every reachable
    // node serves both passes and neither rule below changes anything). The
    // router drops a gateway's share in a pass that cannot reach it, with no
    // renormalisation, so collapsing must not throw a direction away: the
    // representative is a node both passes can use when the crossing has one,
    // and a nearby crossing is skipped only when the one already taken serves
    // every pass it does. The two carriageways of a divided road therefore
    // stay two gateways when each serves only its own direction.
    const TOP_PER_OCTANT = 3;
    const NODE_MERGE_M = 100;
    const PORTAL_MERGE_M = 60;
    const within = (a: number, b: number, m: number) =>
      distMi(g.nodeLat[a]!, g.nodeLon[a]!, g.nodeLat[b]!, g.nodeLon[b]!) * 1609.344 < m;
    // Representative order within a crossing: more passes served, then
    // capacity desc, then node index.
    const repOrder = (a: Cand, b: Cand) => passes(b.dirs) - passes(a.dirs) || b.cap - a.cap || a.node - b.node;
    const gateways: CordonGateway[] = [];
    for (const [oct, share] of octShare) {
      const byPortal = new Map<number, Cand>();
      for (const m of byOct.get(oct)!) {
        const cur = byPortal.get(m.portal);
        if (!cur || repOrder(m, cur) < 0) byPortal.set(m.portal, m);
      }
      // Deterministic order: capacity desc, then node index — so equal-capacity
      // cut-offs are stable across runs.
      const crossings = [...byPortal.values()].sort((a, b) => b.cap - a.cap || a.node - b.node);
      const members: Cand[] = [];
      for (const c of crossings) {
        if (members.length === TOP_PER_OCTANT) break;
        if (members.some((m) => (m.dirs | c.dirs) === m.dirs
          && (within(m.node, c.node, NODE_MERGE_M) || within(m.portal, c.portal, PORTAL_MERGE_M)))) continue;
        members.push(c);
      }
      members.sort((a, b) => a.node - b.node);
      const capTotal = members.reduce((s, m) => s + m.cap, 0);
      for (const m of members) {
        const w = capTotal > 0 ? m.cap / capTotal : 1 / members.length;
        const s = share * w;
        if (s <= 0) continue;
        gateways.push({
          node: m.node,
          lat: g.nodeLat[m.node]!,
          lon: g.nodeLon[m.node]!,
          octant: oct,
          share: s,
        });
      }
    }
    if (gateways.length === 0) continue;

    // Normalise away float drift so Σ share === 1 exactly enough for the
    // ledger's conservation assert downstream.
    const sum = gateways.reduce((s, gw) => s + gw.share, 0);
    for (const gw of gateways) gw.share /= sum;
    gateways.sort((a, b) => a.node - b.node);

    return { gateways, emptyOctants, classCeiling: ceiling };
  }
  return null;
}

/**
 * Snap study signals to real graph junctions, with the guards hazard 5 needs:
 *
 *  - a junction must have >=3 DISTINCT incident bearings (15 deg quantisation)
 *    — 81% of graph nodes are degree-2 polyline shape points where no turn can
 *    exist, and snapping a signal to one mid-block would fabricate a
 *    straight-through table at what is really an intersection;
 *  - the snap is capped at `maxMeters` (default 100 m) — beyond that the
 *    graph simply does not contain this intersection (minor legs absent);
 *  - one node may be claimed by ONE signal — OSM way-splitting can put two
 *    inventory signals near a single graph node, and letting both claim it
 *    would double-count every turn.
 *
 * Returns one entry per input point: the claimed node, or -1 with a reason.
 * Reasons feed the report's `movementSource` explanation — an unresolved
 * signal is a fact worth printing, not an error.
 */
export type JunctionSnap =
  | { node: number; reason: "resolved" }
  | { node: -1; reason: "no_junction_in_range" | "node_already_claimed" };

export function snapSignalsToJunctions(
  g: Graph,
  points: Array<{ lat: number; lon: number }>,
  opts: { maxMeters?: number; minBearingGroups?: number } = {},
): JunctionSnap[] {
  const maxMeters = opts.maxMeters ?? 100;
  const minGroups = opts.minBearingGroups ?? 3;
  const n = g.nodeLat.length;

  // Distinct incident bearing groups per node, 15 deg quantisation.
  const groups = new Array<number>(n).fill(0);
  {
    const seen: Array<Set<number> | undefined> = new Array(n);
    for (const lk of g.links) {
      for (const [from, to] of [[lk.a, lk.b], [lk.b, lk.a]] as const) {
        const q = Math.round(
          bearingDeg(g.nodeLat[from]!, g.nodeLon[from]!, g.nodeLat[to]!, g.nodeLon[to]!) / 15,
        ) % 24;
        (seen[from] ??= new Set()).add(q);
      }
    }
    for (let i = 0; i < n; i++) groups[i] = seen[i]?.size ?? 0;
  }
  const junctions: number[] = [];
  for (let i = 0; i < n; i++) if (groups[i]! >= minGroups) junctions.push(i);

  const claimed = new Set<number>();
  return points.map((p2) => {
    let best = -1, bestM = Infinity;
    for (const j of junctions) {
      const m = distMi(p2.lat, p2.lon, g.nodeLat[j]!, g.nodeLon[j]!) * 1609.34;
      if (m < bestM) { bestM = m; best = j; }
    }
    if (best < 0 || bestM > maxMeters) return { node: -1, reason: "no_junction_in_range" };
    if (claimed.has(best)) return { node: -1, reason: "node_already_claimed" };
    claimed.add(best);
    return { node: best, reason: "resolved" };
  });
}
