/**
 * Junction groups: the routing-graph nodes that make up ONE study
 * intersection when the road network models it as several.
 *
 * OSM maps a divided road as a pair of one-way carriageways. Where it crosses
 * a side street, each carriageway meets the side street at its own node, and
 * the signal inventory carries one record per carriageway. dedupCloseSignals
 * keeps one record as the study row and merges the others away, and the
 * conserved assignment used to read the turn ledger at the kept record's node
 * only. That node carries one carriageway, so one direction of project
 * traffic: at Brightshore (Collier FL) Immokalee Rd & 41st Ave NE carried the
 * 518 outbound trips and none of the 1,134 inbound ones, while Immokalee Rd &
 * Oil Well Rd carried inbound trips only (DATUM-LOG-2026-10-23, first DEFECT;
 * the same defect at McKnight Rd, DATUM-LOG-2026-10-06 item 1).
 *
 * A study junction's group is its snapped junction node plus the one-way
 * (carriageway) nodes its records stand on or snap to:
 *  - the node each of its records (kept and merged) stands on, within
 *    RECORD_NODE_MAX_M. Inventories built from OSM put each record ON its
 *    carriageway's node (0 m in every region surveyed), and at a divided T
 *    that node can be a plain carriageway node the side street never touches
 *    (41st Ave NE meets the westbound carriageway only; the eastbound
 *    carriageway's signal node is a degree-2 node, and every vehicle on that
 *    carriageway passes through the signal);
 *  - the junction each MERGED record would have snapped to as a study signal
 *    of its own (snapSignalsToJunctions, same cap), for inventories whose
 *    records sit between nodes.
 * Only nodes on a one-way link join: on a two-way road one node already sees
 * both directions, so a two-way junction keeps its single node and its output
 * is unchanged. A node that is another study signal's junction, or already in
 * an earlier signal's group, is left where it is — groups are disjoint.
 *
 * The router then records each path ONCE per group, from the link it enters
 * the group on to the link it leaves on (network-assignment GroupTurnFlow),
 * and the junction's legs are the group's external links with each road's
 * two carriageways paired into one two-way leg (junctionLegsAtGroup).
 */
import type { JunctionLeg } from "@workspace/tis-engine-core";
import type { Graph } from "./network-assignment.ts";
import { snapSignalsToJunctions } from "./cordon-gateways.ts";
import { haversineMeters } from "./intersection-coverage.ts";

/** A record farther than this from every graph node stands on none of them.
 *  The on-junction radius of the name-aware snap: inventory points that sit
 *  between a divided road's carriageways are commonly 15–30 m from a node. */
export const RECORD_NODE_MAX_M = 30;

/** An entering and a leaving one-way leg this close in bearing are one road's
 *  two carriageways (a divided road's carriageways leave a junction nearly
 *  parallel; two different roads on one side of a junction rarely do). */
export const CARRIAGEWAY_PAIR_MAX_DEG = 35;

export type GroupInput = {
  /** The study signal's snapped junction node; -1 when it did not resolve. */
  node: number;
  /** The kept inventory record. */
  record: { lat: number; lon: number };
  /** The records dedupCloseSignals merged into it. */
  absorbed: Array<{ lat: number; lon: number }>;
};

/**
 * Per study signal, its junction group — the snapped node first, then the
 * added carriageway nodes in index order — or undefined when no node is added
 * (the signal keeps its single-node ledger, byte for byte).
 */
export function junctionNodeGroups(g: Graph, inputs: GroupInput[]): Array<number[] | undefined> {
  const oneWay = new Uint8Array(g.nodeLat.length);
  for (const lk of g.links) if (lk.dir !== 0) { oneWay[lk.a] = 1; oneWay[lk.b] = 1; }
  const primaries = new Set(inputs.flatMap((c) => (c.node >= 0 ? [c.node] : [])));
  // One snap call over every merged record, in signal order: a junction two
  // records want goes to the first, which is the claim rule groups need too.
  const absorbedPts = inputs.flatMap((c, i) => (c.node >= 0 ? c.absorbed.map((p) => ({ ...p, owner: i })) : []));
  const snaps = absorbedPts.length > 0 ? snapSignalsToJunctions(g, absorbedPts) : [];
  const snappedBy = new Map<number, number[]>();
  absorbedPts.forEach((p, k) => {
    const s = snaps[k]!;
    if (s.node < 0) return;
    const arr = snappedBy.get(p.owner);
    if (arr) arr.push(s.node);
    else snappedBy.set(p.owner, [s.node]);
  });

  const taken = new Set<number>();
  return inputs.map((c, i) => {
    if (c.node < 0) return undefined;
    const wanted: number[] = [];
    for (const p of [c.record, ...c.absorbed]) {
      const n = g.nearestNode(p.lat, p.lon);
      if (n >= 0 && haversineMeters(p.lat, p.lon, g.nodeLat[n]!, g.nodeLon[n]!) <= RECORD_NODE_MAX_M) wanted.push(n);
    }
    wanted.push(...(snappedBy.get(i) ?? []));
    const extras = [...new Set(wanted)]
      .filter((n) => n !== c.node && oneWay[n] === 1 && !primaries.has(n) && !taken.has(n))
      .sort((a, b) => a - b);
    if (extras.length === 0) return undefined;
    for (const n of extras) taken.add(n);
    taken.add(c.node);
    return [c.node, ...extras];
  });
}

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * p) * Math.cos(la2 * p);
  const x = Math.cos(la1 * p) * Math.sin(la2 * p) - Math.sin(la1 * p) * Math.cos(la2 * p) * Math.cos((lo2 - lo1) * p);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angDiff = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** Circular mean of two bearings (they are within CARRIAGEWAY_PAIR_MAX_DEG). */
function meanBearing(a: number, b: number): number {
  const p = Math.PI / 180;
  return ((Math.atan2(Math.sin(a * p) + Math.sin(b * p), Math.cos(a * p) + Math.cos(b * p)) / p) + 360) % 360;
}

/**
 * The legs of a junction group, as junctionLegsAtNode describes a single
 * node's: every link with exactly one end in the group, its bearing taken
 * from that end (the same point the path turns' bearings are taken from).
 * Links between two group nodes are inside the junction and are not legs.
 *
 * A divided road reaches the junction as two one-way legs on one side, one
 * entering and one leaving. Each such pair (bearings within
 * CARRIAGEWAY_PAIR_MAX_DEG, closest first) becomes ONE two-way leg, so the
 * leg-volume resolver gives that side the road's volume in both directions,
 * as it does for an undivided road, instead of only the carriageway the kept
 * node happened to stand on.
 */
export function junctionLegsAtGroup(g: Graph, nodes: number[], incidence: Map<number, number[]>): JunctionLeg[] {
  const inGroup = new Set(nodes);
  const legs: JunctionLeg[] = [];
  for (const node of nodes) {
    for (const li of incidence.get(node) ?? []) {
      const lk = g.links[li];
      if (!lk) continue;
      const far = lk.a === node ? lk.b : lk.a;
      if (inGroup.has(far)) continue;
      const oneWay: JunctionLeg["oneWay"] =
        lk.dir === 0 ? null
        : lk.a === node ? (lk.dir === 1 ? "out" : "in")
        : (lk.dir === 1 ? "in" : "out");
      legs.push({ bearingDeg: bearingDeg(g.nodeLat[node]!, g.nodeLon[node]!, g.nodeLat[far]!, g.nodeLon[far]!), cls: lk.cls, oneWay });
    }
  }
  const ins = legs.flatMap((l, i) => (l.oneWay === "in" ? [i] : []));
  const outs = legs.flatMap((l, i) => (l.oneWay === "out" ? [i] : []));
  const pairs = ins.flatMap((a) => outs.map((b) => ({ a, b, d: angDiff(legs[a]!.bearingDeg, legs[b]!.bearingDeg) })))
    .filter((p) => p.d <= CARRIAGEWAY_PAIR_MAX_DEG)
    .sort((x, y) => x.d - y.d || x.a - y.a || x.b - y.b);
  const used = new Set<number>();
  const merged = new Map<number, JunctionLeg>();
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a); used.add(p.b);
    merged.set(Math.min(p.a, p.b), {
      bearingDeg: meanBearing(legs[p.a]!.bearingDeg, legs[p.b]!.bearingDeg),
      cls: Math.min(legs[p.a]!.cls, legs[p.b]!.cls),
      oneWay: null,
    });
  }
  return legs.flatMap((l, i) => (merged.has(i) ? [merged.get(i)!] : used.has(i) ? [] : [l]));
}
