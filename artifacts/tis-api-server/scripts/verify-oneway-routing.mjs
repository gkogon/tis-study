// Regression check: the router honours one-way streets.
//
// The data pipeline captured `oneway` (slice 2) but the router kept treating
// every link as bidirectional — harmless while no region carried the tag,
// WRONG the moment Miami-Dade re-fetched with 37% of ways tagged: a
// path-derived movement table could print a left turn against traffic on a
// one-way pair, the exact "visibly wrong to any reviewing engineer" failure
// the design flagged as hazard 2.
//
// Enforcement is at ADJACENCY-BUILD time: a forbidden direction simply is not
// an edge, so Dijkstra, the MSA loading, the turn ledger and the driveway
// splitter all inherit the constraint with zero special cases.
//
// Run: node ./scripts/verify-oneway-routing.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { buildGraph, assignRoutesWithTurns, insertDriveway } = await import(
  path.resolve(here, "../src/lib/network-assignment.ts")
);
const { roadSegmentsNear } = await import(
  path.resolve(here, "../../api-server/src/lib/regional-roads.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const LAT = 33.75, LON = -84.39, STEP = 0.004;
// seg(aLon, bLon, dir) on one E-W street at LAT; dir in RoadSegment[8].
const seg = (aLat, aLon, bLat, bLon, dir = 0, name = "S") =>
  [3, aLat, aLon, bLat, bLon, 2, 30, name, dir];

// ---------------------------------------------------------------------------
// 1. One-way pair fixture. Site between an eastbound-only street (north) and a
//    westbound-only street (south), connected by two-way cross streets:
//
//        A ──east-only──▶ B          (northern one-way, a→b)
//        │                │          (two-way connectors)
//        D ◀──west-only── C          (southern one-way, b→a in segment terms)
//
//    Destination EAST of B: legal route uses the northern street. Destination
//    WEST of D: legal route uses the southern street. A bidirectional router
//    would happily run west along the northern street — the fixture fails if
//    any flow traverses a link against its direction.
// ---------------------------------------------------------------------------
{
  const latN = LAT + STEP, latS = LAT - STEP;
  const segments = [
    seg(latN, LON - STEP, latN, LON, 1, "North One-Way"),        // A→(mid) east-only
    seg(latN, LON, latN, LON + STEP, 1, "North One-Way"),        // (mid)→B east-only
    seg(latS, LON, latS, LON - STEP, 1, "South One-Way"),        // (mid)→D... a→b = east-to-west = WESTBOUND-only
    seg(latS, LON + STEP, latS, LON, 1, "South One-Way"),        // C→(mid) westbound-only
    seg(latN, LON, latS, LON, 0, "Cross"),                       // two-way connector at mid
    seg(latN, LON - STEP, latS, LON - STEP, 0, "Cross W"),
    seg(latN, LON + STEP, latS, LON + STEP, 0, "Cross E"),
  ];
  const site = { lat: LAT, lon: LON };
  // Site snaps to the mid cross-street. Destinations: east end + west end.
  const dests = [
    { lat: latN, lon: LON + STEP, trips: 50 },  // NE corner (east end of north st)
    { lat: latS, lon: LON - STEP, trips: 50 },  // SW corner (west end of south st)
  ];
  const g = buildGraph(segments);
  // Structural: one-way links appear in exactly ONE adjacency list.
  let oneWayLinks = 0, violations = 0;
  g.links.forEach((lk, li) => {
    if (lk.dir === 0) return;
    oneWayLinks++;
    const inA = (g.adj[lk.a] ?? []).includes(li);
    const inB = (g.adj[lk.b] ?? []).includes(li);
    if (lk.dir === 1 && (!inA || inB)) violations++;
    if (lk.dir === -1 && (inA || !inB)) violations++;
  });
  ok(oneWayLinks === 4 && violations === 0,
    `fixture: ${oneWayLinks} one-way links each appear in exactly the legal adjacency (${violations} violations)`);

  const { assignment, turns, conservation } = assignRoutesWithTurns(site, dests, segments);
  ok(assignment.available && assignment.destinationsRouted === 2,
    `fixture: both destinations routed despite one-way constraints (${assignment.destinationsRouted}/2)`);
  ok(conservation.balanced, "fixture: conservation holds under one-way routing");

  // No recorded turn may traverse a link against its direction. Reconstruct
  // travel direction: entering node v on link e means travel other(e,v)→v.
  const other = (li, v) => (g.links[li].a === v ? g.links[li].b : g.links[li].a);
  let wrongWay = 0;
  for (const t of turns) {
    for (const [li, into] of [[t.inLink, t.node], [t.outLink, other(t.outLink, t.node)]]) {
      const lk = g.links[li];
      const from = other(li, into);
      if (lk.dir === 1 && !(from === lk.a && into === lk.b)) wrongWay++;
      if (lk.dir === -1 && !(from === lk.b && into === lk.a)) wrongWay++;
    }
  }
  ok(wrongWay === 0, `fixture: zero wrong-way traversals in the turn ledger (${turns.length} turns checked)`);
}

// ---------------------------------------------------------------------------
// 2. Old-format region (no oneway data) routes byte-identically to before:
//    every dir is 0, both adjacency entries exist — the legacy behaviour.
// ---------------------------------------------------------------------------
{
  // Control region picked DYNAMICALLY: the rollout converts regions one at a
  // time, so any hardcoded control (akron, once) goes stale the day it is
  // re-fetched. Old vintage = no way in the file carries the oneway slot.
  const dataDir = path.resolve(here, "../../api-server/src/data");
  const control = (() => {
    for (const f of fs.readdirSync(dataDir).sort()) {
      if (!f.endsWith("-roads.json") || fs.existsSync(path.join(dataDir, f + ".gz"))) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
        const ways = d.ways ?? [];
        if (!ways.length || ways.slice(0, 50).some((w) => w.length >= 6)) continue;
        const poly = ways[0].find((s) => Array.isArray(s) && Array.isArray(s[0]));
        if (!poly?.[0]) continue;
        const slug = f.slice(0, -"-roads.json".length);
        for (const code of [`${slug.replace(/-/g, "_")}_metro`, slug.replace(/-/g, "_")]) {
          const segs = roadSegmentsNear(code, poly[0][0], poly[0][1], 1.0) ?? [];
          if (segs.length > 50) return { code, segs };
        }
      } catch { /* unreadable — keep scanning */ }
    }
    return null;
  })();
  if (control) {
    const g = buildGraph(control.segs);
    ok(g.links.every((lk) => lk.dir === 0),
      `old-format (${control.code}): every link is two-way (${g.links.length} links) — pre-rollout regions unchanged`);
    ok(g.links.every((lk, li) =>
      (g.adj[lk.a] ?? []).includes(li) && (g.adj[lk.b] ?? []).includes(li)),
      `old-format (${control.code}): both adjacency entries exist for every link (legacy shape)`);
  } else {
    console.log("skip: no old-vintage region remains — rollout complete; legacy-control section obsolete");
  }
}

// ---------------------------------------------------------------------------
// 3. Real Miami network (37% oneway): constraints enforced, routing still
//    succeeds, conservation still exact.
// ---------------------------------------------------------------------------
{
  const SITE = { lat: 25.8456, lon: -80.2103 };
  const segments = roadSegmentsNear("miami_dade_metro", SITE.lat, SITE.lon, 1.0) ?? [];
  ok(segments.length > 500, `miami: segments loaded (${segments.length})`);
  const g = buildGraph(segments);
  const oneWay = g.links.filter((lk) => lk.dir !== 0).length;
  // Data-conditional: this branch may predate the miami re-fetch (the data
  // lands via the rollout branch). Old-format data has no oneway to assert on
  // — skip LOUDLY rather than fail, but never skip silently.
  if (oneWay === 0) {
    console.log("SKIP: miami data on this checkout is pre-rollout (no oneway tags) — one-way assertions covered by the fixture above; re-runs at full strength once the data branch merges");
  } else {
  ok(oneWay > 100, `miami: real one-way links in the graph (${oneWay}/${g.links.length})`);
  let violations = 0;
  g.links.forEach((lk, li) => {
    if (lk.dir === 1 && (g.adj[lk.b] ?? []).includes(li)) violations++;
    if (lk.dir === -1 && (g.adj[lk.a] ?? []).includes(li)) violations++;
  });
  ok(violations === 0, `miami: no illegal adjacency entries (${violations})`);

  const dests = [];
  for (let i = 0; i < 8; i++) {
    const th = (i / 8) * 2 * Math.PI;
    dests.push({ lat: SITE.lat + 0.008 * Math.cos(th), lon: SITE.lon + 0.008 * Math.sin(th), trips: 25 });
  }
  const { assignment, conservation } = assignRoutesWithTurns(SITE, dests, segments);
  ok(assignment.available && assignment.onNetworkPct >= 75,
    `miami: routing still succeeds under one-way constraints (${assignment.onNetworkPct}% on-network)`);
  ok(conservation.balanced,
    `miami: conservation exact with one-way enforcement (imbalance ${conservation.maxImbalance})`);
  }
}

// ---------------------------------------------------------------------------
// 4. Driveway split on a one-way street does not re-open the illegal direction.
// ---------------------------------------------------------------------------
{
  const segments = [seg(LAT, LON - STEP, LAT, LON + STEP, 1, "One-Way Ave")];
  const g = buildGraph(segments);
  const siteNode = g.nodeOf(LAT + 0.001, LON);
  const { drivewayNode } = insertDriveway(g, siteNode, LAT + 0.0001, LON);
  let violations = 0;
  g.links.forEach((lk, li) => {
    if (lk.dir === 1 && (g.adj[lk.b] ?? []).includes(li)) violations++;
    if (lk.dir === -1 && (g.adj[lk.a] ?? []).includes(li)) violations++;
  });
  ok(violations === 0 && drivewayNode >= 0,
    `driveway split on a one-way street keeps both halves one-way (${violations} violations)`);
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
