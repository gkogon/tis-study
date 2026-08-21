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
 * within the octant by corridor importance (Σ capVph of the gateway's incident
 * links). This is deliberate: the printed distribution section stays the
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
 * Select the cordon for a study.
 *
 * @param g          graph built from the fetched segments (radius + 0.25 pad)
 * @param site       project site
 * @param radiusMi   the study radius the fetch was made for
 * @param byDirection the §6.1 directional distribution, percentages summing
 *                    to ~100 (the engine's rollup guarantees this)
 * @returns null when no usable cordon exists (caller keeps the legacy path)
 */
export function selectCordonGateways(
  g: Graph,
  site: { lat: number; lon: number },
  radiusMi: number,
  byDirection: Record<CardinalDir, number>,
): CordonSelection | null {
  const n = g.nodeLat.length;
  if (n === 0) return null;

  // --- Candidate ring -----------------------------------------------------
  // Outer ring = at or beyond the study radius (the fetch pads past it). The
  // 0.05 mi tolerance absorbs the radial truncation's soft edge.
  const RING_MIN = Math.max(0.05, radiusMi - 0.05);

  // Highest road class (lowest code) incident to each node, and the summed
  // capacity used as the within-octant importance weight.
  const bestCls = new Array<number>(n).fill(99);
  const capSum = new Array<number>(n).fill(0);
  for (const lk of g.links) {
    if (lk.cls < bestCls[lk.a]!) bestCls[lk.a] = lk.cls;
    if (lk.cls < bestCls[lk.b]!) bestCls[lk.b] = lk.cls;
    capSum[lk.a]! += lk.capVph;
    capSum[lk.b]! += lk.capVph;
  }

  type Cand = { node: number; octant: CardinalDir; cap: number };
  // Escalating class ceilings: prefer a cordon of real corridors (≤ secondary),
  // fall back to collectors, then to any boundary node. A cordon of service
  // alleys would route arterial traffic through them; better to relax only
  // when the stricter cordon genuinely does not exist.
  for (const ceiling of [3, 4, 99]) {
    const cands: Cand[] = [];
    for (let i = 0; i < n; i++) {
      if (bestCls[i]! > ceiling) continue;
      const d = distMi(site.lat, site.lon, g.nodeLat[i]!, g.nodeLon[i]!);
      if (d < RING_MIN) continue;
      cands.push({
        node: i,
        octant: bearingToCardinal(bearingDeg(site.lat, site.lon, g.nodeLat[i]!, g.nodeLon[i]!)),
        cap: capSum[i]!,
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

    // Within an octant: keep only the TOP-3 candidates by capacity, then split
    // the octant's share by capacity (evenly when capacities are all 0).
    //
    // Without the cap, a dense urban ring yields hundreds of gateways (427
    // measured on the Miami corridor) and the demand smears into sub-vehicle
    // trickles on every residential stub that happens to cross the ring. Real
    // traffic leaves a study area on its arterials; concentrating each
    // octant's demand on its highest-capacity ring crossings is both the
    // defensible engineering assumption and what keeps the turn ledger's
    // flows large enough to survive integer rounding downstream.
    const TOP_PER_OCTANT = 3;
    const gateways: CordonGateway[] = [];
    for (const [oct, share] of octShare) {
      let members = byOct.get(oct)!;
      // Deterministic order: capacity desc, then node index — so equal-capacity
      // cut-offs are stable across runs.
      members = [...members].sort((a, b) => b.cap - a.cap || a.node - b.node)
        .slice(0, TOP_PER_OCTANT)
        .sort((a, b) => a.node - b.node);
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
