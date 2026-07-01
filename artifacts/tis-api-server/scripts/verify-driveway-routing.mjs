import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { buildGraph, insertDriveway, nearestLinkPoint } = m;

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

// A single east–west segment (class 3) from (0,0)→(0,0.01) [~0.69 mi of lon at equator-ish].
const segs = [[3, 0, 0, 0, 0.01, null, null]];
const g = buildGraph(segs, []);
ok(g.links.length === 1, `one link built (got ${g.links.length})`);
ok(g.nodeLat.length === 2, `two nodes built (got ${g.nodeLat.length})`);

// Snap a driveway just south of the segment midpoint.
const snap = nearestLinkPoint(g, -0.0001, 0.005);
ok(snap.li === 0 && snap.t > 0.4 && snap.t < 0.6, `driveway snaps to mid of link 0 (t=${snap.t?.toFixed(2)})`);

const before = { links: g.links.length, nodes: g.nodeLat.length };
const siteNode = g.nodeOf(-0.0003, 0.005); // a site node south of the road
const ins = insertDriveway(g, siteNode, -0.0001, 0.005);
ok(g.links.length === before.links + 2, `split adds 2 links net (1 split→2 + access), got +${g.links.length - before.links}`);
ok(g.nodeLat.length >= before.nodes + 1, `driveway node added`);
ok((g.adj[ins.drivewayNode] ?? []).length >= 3, `driveway node connects to both split halves + access link (got ${(g.adj[ins.drivewayNode]||[]).length})`);
ok((g.adj[siteNode] ?? []).includes(ins.accessLink), `site connects to the driveway via the access link`);
// Verify orig.b adj is self-consistent after the split: snap.li (link 0) was reshaped
// to a→dn and no longer connects orig.b, so adj[orig.b] must not contain snap.li
// (unless the link still actually touches orig.b, which it doesn't after reshape).
const orig_b_adj = g.adj[1] ?? []; // orig.b = node 1 (the lon=0.01 end of the original segment)
ok(orig_b_adj.every(li => g.links[li].a === 1 || g.links[li].b === 1),
  `adj[orig.b] contains only links that still touch orig.b after split (stale-adj guard)`);

const { assignWithDriveways } = m;
// Cross road: an east–west street through the site + a north–south street to the east
// with a signal (destination) at the NE corner. Site at (0, 0).
const segsX = [
  [3, 0, -0.01, 0, 0.01, null, null],   // E-W street through the site latitude
  [3, -0.005, 0.008, 0.005, 0.008, null, null], // N-S street to the east (x≈0.008)
];
const site = { lat: -0.0003, lon: 0.0 };       // just south of the E-W street
const dests = [
  { lat: 0.0, lon: 0.008, trips: 100 },        // signal to the EAST (odBearing ≈ 90°)
  { lat: 0.0, lon: -0.008, trips: 100 },       // signal to the WEST (odBearing ≈ 270°)
];
// Full-access driveway on the E-W street just north of the site.
const full = [{ id: "dwA", latitude: -0.00005, longitude: 0.0, accessType: "full", movements: { inLeft: true, inRight: true, outLeft: true, outRight: true } }];
const rFull = assignWithDriveways(site, dests, segsX, full, {});
ok(rFull.available, "full-access assignment available");
const totFull = rFull.perDestinationAddedTrips.reduce((s, v) => s + v, 0);
ok(Math.abs(totFull - 200) < 1e-6, `full access conserves trips (got ${totFull})`);
ok(rFull.reroutes.length === 0, "full access ⇒ no reroutes");

// RIRO driveway: forbids out-left. Trips exiting to the WEST (a left turn out of a
// south-side driveway) can't leave directly ⇒ must reroute (U-turn).
const riro = [{ id: "dwA", latitude: -0.00005, longitude: 0.0, accessType: "riro", movements: { inLeft: false, inRight: true, outLeft: false, outRight: true } }];
const rRiro = assignWithDriveways(site, dests, segsX, riro, {});
ok(rRiro.reroutes.length > 0, "RIRO driveway forces at least one reroute");
ok(rRiro.driveways[0].reroutedTrips > 0, "the RIRO driveway records rerouted trips");
const totRiro = rRiro.perDestinationAddedTrips.reduce((s, v) => s + v, 0);
ok(Math.abs(totRiro - 200) < 1e-6, `reroute conserves total trips (got ${totRiro})`);

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
