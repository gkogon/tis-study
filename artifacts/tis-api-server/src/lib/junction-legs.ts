/**
 * Incident links at a routing-graph node, described the way the leg-volume
 * resolver wants them: bearing from the node to the far end, OSM class, and
 * the one-way sense RELATIVE TO THE NODE ("in" = traffic can only travel
 * toward it). Link.dir is stored a→b (+1), b→a (-1), two-way (0), so the
 * sense flips depending on which end the node is.
 *
 * NOT built from Graph.adj: that is the ROUTING adjacency, and a one-way link
 * is deliberately listed at only the node it can be traversed FROM
 * (network-assignment.ts buildGraph), so a one-way link INTO a junction is
 * absent from adj[junction]. A leg you can only arrive by is still a leg.
 * incidentLinks() scans link endpoints once per graph instead.
 */
import type { JunctionLeg } from "@workspace/tis-engine-core";
import type { Graph } from "./network-assignment";

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * p) * Math.cos(la2 * p);
  const x = Math.cos(la1 * p) * Math.sin(la2 * p) - Math.sin(la1 * p) * Math.cos(la2 * p) * Math.cos((lo2 - lo1) * p);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** node → indices of every link touching it, regardless of direction. Build once per graph. */
export function incidentLinks(g: Graph): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const add = (n: number, li: number) => { const arr = m.get(n); if (arr) arr.push(li); else m.set(n, [li]); };
  g.links.forEach((lk, li) => { if (lk.a !== lk.b) { add(lk.a, li); add(lk.b, li); } });
  return m;
}

export function junctionLegsAtNode(g: Graph, node: number, incidence: Map<number, number[]>): JunctionLeg[] {
  const out: JunctionLeg[] = [];
  for (const li of incidence.get(node) ?? []) {
    const lk = g.links[li];
    if (!lk) continue;
    const far = lk.a === node ? lk.b : lk.a;
    const oneWay: JunctionLeg["oneWay"] =
      lk.dir === 0 ? null
      : lk.a === node ? (lk.dir === 1 ? "out" : "in")
      : (lk.dir === 1 ? "in" : "out");
    out.push({
      bearingDeg: bearingDeg(g.nodeLat[node]!, g.nodeLon[node]!, g.nodeLat[far]!, g.nodeLon[far]!),
      cls: lk.cls,
      oneWay,
    });
  }
  return out;
}
