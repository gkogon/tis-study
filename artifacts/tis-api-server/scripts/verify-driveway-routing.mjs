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

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
