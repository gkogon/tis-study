// Regression check: a divided road's junction loads BOTH directions of
// project traffic.
//
// OSM maps a divided road as two one-way carriageways, and the signal
// inventory carries one record per carriageway. dedupCloseSignals keeps one
// record as the study row; the conserved assignment used to read the turn
// ledger at that record's node only, which carries one carriageway, so one
// direction. Datum logged it twice: Brightshore (Collier FL,
// DATUM-LOG-2026-10-23, first DEFECT: Immokalee Rd & 41st Ave NE carried the
// 518 outbound PM trips and none of the 1,134 inbound; Immokalee Rd & Oil
// Well Rd inbound only) and McKnight Rd (Allegheny, DATUM-LOG-2026-10-06,
// item 1). The fix groups the junction's carriageway nodes
// (junction-groups.ts), and the router records each path once per group
// (network-assignment.ts GroupTurnFlow). This script asserts:
//
//   1. Fixture: a divided arterial (two one-way carriageways ~30 m apart)
//      crossed by a two-way street; the site sits down the arterial behind a
//      median crossover, so outbound trips use one carriageway and inbound
//      trips the other. The node ledger at either carriageway node sees ONE
//      direction (the defect, reproduced on the router's own output).
//   2. Groups: junctionNodeGroups puts both carriageway nodes in the kept
//      signal's group; two-way roads and lone records get no group; groups
//      are disjoint and never take another signal's junction.
//   3. Router: the group ledger counts each path once — a vehicle that
//      crosses both carriageways is ONE movement (the left turn), not a turn
//      at one node plus a through at the other. Group totals equal the trips
//      routed through the junction, in each direction, exactly. Passing no
//      groups leaves every other output field byte-identical.
//   4. Legs: the group's legs pair each road's two carriageways into one
//      two-way leg, so both main-road directions carry background volume.
//   5. Engine E2E (generateTisReport, fetch mocked with the fixture): the
//      divided junction's row carries outbound AND inbound path turns, its
//      added trips are the blend of both, the two integer cross-foots hold,
//      conservation balances, and the run is deterministic.
//   6. Real network (in-repo Collier road file + FL signal inventory, the
//      Brightshore site): the four divided junctions Datum named carry both
//      directions. Skips LOUDLY when the data files are absent.
//
// Run: node ./scripts/verify-divided-junctions.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";

const { buildGraph, assignRoutesWithTurns } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { snapSignalsToJunctions } = await import(path.resolve(here, "../src/lib/cordon-gateways.ts"));
const { junctionNodeGroups, junctionLegsAtGroup } = await import(path.resolve(here, "../src/lib/junction-groups.ts"));
const { incidentLinks, junctionLegsAtNode } = await import(path.resolve(here, "../src/lib/junction-legs.ts"));
const { dedupCloseSignals, intersectionsWithinRadius } = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const { buildLegEstimate } = await import(path.resolve(here, "../../../lib/tis-engine-core/src/leg-volumes.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sum = (rows) => rows.reduce((s, t) => s + (t.trips ?? t.share), 0);

const bearing = (g, a, b) => {
  const p = Math.PI / 180;
  const y = Math.sin((g.nodeLon[b] - g.nodeLon[a]) * p) * Math.cos(g.nodeLat[b] * p);
  const x = Math.cos(g.nodeLat[a] * p) * Math.sin(g.nodeLat[b] * p)
    - Math.sin(g.nodeLat[a] * p) * Math.cos(g.nodeLat[b] * p) * Math.cos((g.nodeLon[b] - g.nodeLon[a]) * p);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const other = (g, li, v) => (g.links[li].a === v ? g.links[li].b : g.links[li].a);
const card = (deg) => ["N", "E", "S", "W"][Math.round(deg / 90) % 4];
// "NB-L" style label of a movement, from the travel bearings in and out.
const movement = (inDeg, outDeg) => {
  const dir = { N: "NB", E: "EB", S: "SB", W: "WB" }[card(inDeg)];
  const turn = ((Math.round(outDeg / 90) - Math.round(inDeg / 90)) % 4 + 4) % 4;
  return `${dir}-${["T", "R", "U", "L"][turn]}`;
};
const groupMovement = (g, t) => movement(bearing(g, other(g, t.inLink, t.inNode), t.inNode), bearing(g, t.outNode, other(g, t.outLink, t.outNode)));

// ---------------------------------------------------------------------------
// 1. Fixture network.
//
//              N_end
//                |  (two-way)
//             N_split
//            /       \
//   SB cway |         | NB cway        (one-way, ~30 m apart)
//  W_end ---A---------B--- E_end       (cross street, two-way)
//           |         |
//          S1w ===== S1 --- SITE       (median crossover + site street)
//           |         |
//            \       /
//             S_split
//                |
//              S_end
// ---------------------------------------------------------------------------
const LAT0 = 27.0, LON0 = -81.0;
const HALF = 0.00015;                   // ~15 m: half the carriageway separation
const lonW = LON0 - HALF, lonE = LON0 + HALF;
const P = {
  N_end: [LAT0 + 0.016, LON0], N_split: [LAT0 + 0.009, LON0],
  S_end: [LAT0 - 0.020, LON0], S_split: [LAT0 - 0.009, LON0],
  A: [LAT0, lonW], B: [LAT0, lonE],
  S1w: [LAT0 - 0.004, lonW], S1: [LAT0 - 0.004, lonE],
  SITE: [LAT0 - 0.004, LON0 + 0.002],
  W_end: [LAT0, LON0 - 0.016], W_mid: [LAT0, LON0 - 0.006], W_lane: [LAT0 + 0.003, LON0 - 0.006],
  E_end: [LAT0, LON0 + 0.018],
};
// Polyline → segments, with intermediate nodes every ~0.001° so the cordon
// has ring-crossing links to choose from (as real road files do).
const segments = [];
const line = (cls, pts, name, oneway = 0) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [aLat, aLon] = pts[i], [bLat, bLon] = pts[i + 1];
    const steps = Math.max(1, Math.round(Math.max(Math.abs(bLat - aLat), Math.abs(bLon - aLon)) / 0.001));
    for (let k = 0; k < steps; k++) {
      const f0 = k / steps, f1 = (k + 1) / steps;
      segments.push([cls,
        +(aLat + (bLat - aLat) * f0).toFixed(6), +(aLon + (bLon - aLon) * f0).toFixed(6),
        +(aLat + (bLat - aLat) * f1).toFixed(6), +(aLon + (bLon - aLon) * f1).toFixed(6),
        oneway ? 2 : 4, 72, name, oneway]);
    }
  }
};
line(2, [P.N_end, P.N_split], "Arterial Road");
line(2, [P.S_split, P.S_end], "Arterial Road");
// SB carriageway, travelled north → south; NB carriageway, south → north.
line(2, [P.N_split, [LAT0 + 0.008, lonW], P.A, P.S1w, [LAT0 - 0.008, lonW], P.S_split], "Arterial Road", 1);
line(2, [P.S_split, [LAT0 - 0.008, lonE], P.S1, P.B, [LAT0 + 0.008, lonE], P.N_split], "Arterial Road", 1);
line(3, [P.W_end, P.W_mid, P.A], "Cross Street");
line(3, [P.A, P.B], "Cross Street");
line(3, [P.B, P.E_end], "Cross Street");
line(4, [P.W_mid, P.W_lane], "Local Lane");
line(4, [P.S1w, P.S1], null);                 // median opening
line(4, [P.S1, P.SITE], "Site Drive");

const g = buildGraph(segments);
const nodeAt = ([la, lo]) => g.nearestNode(la, lo);
const A = nodeAt(P.A), B = nodeAt(P.B);
ok(A !== B && g.nodeLat[A] === P.A[0] && g.nodeLat[B] === P.B[0], `fixture: carriageway nodes A=${A}, B=${B} exist`);

const SITE = { lat: P.SITE[0], lon: P.SITE[1] };
const gwN = { lat: P.N_end[0], lon: P.N_end[1] };
const gwW = { lat: P.W_end[0], lon: P.W_end[1] };
const SHARE_N = 0.6, SHARE_W = 0.4;
const dests = [{ ...gwN, trips: SHARE_N, tripsIn: SHARE_N }, { ...gwW, trips: SHARE_W, tripsIn: SHARE_W }];

// The defect on the router's own output: the node ledger at each carriageway
// node carries one direction of the through-arterial trips.
const legacy = assignRoutesWithTurns(SITE, dests, segments);
ok(Array.isArray(legacy.turnsInbound), "fixture: one-way graph ⇒ inbound pass ran");
const atNode = (rows, n) => (rows ?? []).filter((t) => t.node === n);
ok(sum(atNode(legacy.turns, B)) > 0 && sum(atNode(legacy.turnsInbound, B)) === 0,
  `fixture reproduces the defect: node B (NB carriageway) sees outbound ${sum(atNode(legacy.turns, B)).toFixed(2)}, inbound ${sum(atNode(legacy.turnsInbound, B)).toFixed(2)}`);
ok(sum(atNode(legacy.turnsInbound, A)) > 0,
  `fixture: node A (SB carriageway) carries the inbound trips the kept node misses (${sum(atNode(legacy.turnsInbound, A)).toFixed(2)})`);

// ---------------------------------------------------------------------------
// 2. Groups.
// ---------------------------------------------------------------------------
const recA = { id: "div-sb", name: "Arterial Road & Cross Street", latitude: P.A[0], longitude: P.A[1], totalVolume: 1800, zone: "FL" };
const recB = { id: "div-nb", name: "Arterial Road & Cross Street", latitude: P.B[0], longitude: P.B[1], totalVolume: 1800, zone: "FL" };
const recW = { id: "west", name: "Cross Street & Local Lane", latitude: P.W_mid[0], longitude: P.W_mid[1], totalVolume: 900, zone: "FL" };
const dd = dedupCloseSignals(intersectionsWithinRadius([recA, recB, recW], SITE.lat, SITE.lon, 2));
ok(dd.kept.length === 2 && dd.merged.length === 1 && dd.kept[dd.mergedInto[0]].sig.name === recA.name,
  `dedup: the two carriageway records are one junction, and mergedInto names it (kept ${dd.kept.map((k) => k.sig.id)}, merged ${dd.merged.map((m) => m.sig.id)} → ${dd.mergedInto})`);
const keptDiv = dd.kept.find((k) => k.sig.name === recA.name);
const absorbedDiv = dd.merged[0].sig;
const snaps = snapSignalsToJunctions(g, dd.kept.map((k) => ({ lat: k.sig.latitude, lon: k.sig.longitude })));
const groups = junctionNodeGroups(g, dd.kept.map((k, i) => ({
  node: snaps[i].node,
  record: { lat: k.sig.latitude, lon: k.sig.longitude },
  absorbed: dd.merged.filter((_, j) => dd.mergedInto[j] === i).map((m) => ({ lat: m.sig.latitude, lon: m.sig.longitude })),
})));
const divIdx = dd.kept.indexOf(keptDiv);
const westIdx = dd.kept.findIndex((k) => k.sig.id === "west");
ok(JSON.stringify([...groups[divIdx]].sort((a, b) => a - b)) === JSON.stringify([A, B].sort((a, b) => a - b)) && groups[divIdx][0] === snaps[divIdx].node,
  `groups: the divided junction's group is its snapped node + the other carriageway's node (${JSON.stringify(groups[divIdx])})`);
ok(groups[westIdx] === undefined, "groups: a junction of two-way roads with one record gets no group (single-node ledger, unchanged)");

// Disjointness: a merged record whose junction is ANOTHER signal's stays with that signal.
const twoSignals = junctionNodeGroups(g, [
  { node: B, record: { lat: P.B[0], lon: P.B[1] }, absorbed: [] },
  { node: A, record: { lat: P.A[0], lon: P.A[1] }, absorbed: [{ lat: P.B[0], lon: P.B[1] }] },
]);
ok(twoSignals[0] === undefined && twoSignals[1] === undefined,
  "groups: a node that is another study signal's junction is never folded in");
// A two-way-only graph forms no groups at all.
const twoWaySegs = segments.map((s) => [...s.slice(0, 8), 0]);
const g2 = buildGraph(twoWaySegs);
const twoWayGroups = junctionNodeGroups(g2, [{ node: g2.nearestNode(...P.B), record: { lat: P.B[0], lon: P.B[1] }, absorbed: [{ lat: P.A[0], lon: P.A[1] }] }]);
ok(twoWayGroups[0] === undefined, "groups: none on a two-way graph (one node already sees both directions)");

// ---------------------------------------------------------------------------
// 3. Router: one movement per path per group, exact totals.
// ---------------------------------------------------------------------------
const net = assignRoutesWithTurns(SITE, dests, segments, { junctionGroups: [groups[divIdx]] });
const gOut = net.groupTurns ?? [], gIn = net.groupTurnsInbound ?? [];
ok(near(sum(gOut), SHARE_N + SHARE_W, 1e-9),
  `router: every outbound trip passes the junction once (group outbound ${sum(gOut).toFixed(6)} = ${SHARE_N + SHARE_W})`);
ok(near(sum(gIn), SHARE_N + SHARE_W, 1e-9),
  `router: every inbound trip passes the junction once (group inbound ${sum(gIn).toFixed(6)} = ${SHARE_N + SHARE_W})`);
const naiveOut = sum(atNode(net.turns, A)) + sum(atNode(net.turns, B));
ok(naiveOut > sum(gOut) + 1e-9,
  `router: summing the two nodes' ledgers would double-count the trips that cross both carriageways (${naiveOut.toFixed(2)} vs ${sum(gOut).toFixed(2)})`);
const movesOf = (rows) => {
  const m = {};
  for (const t of rows) { const k = groupMovement(g, t); m[k] = (m[k] ?? 0) + t.trips; }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +v.toFixed(6)]).sort());
};
const outMoves = movesOf(gOut), inMoves = movesOf(gIn);
ok(JSON.stringify(outMoves) === JSON.stringify({ "NB-L": SHARE_W, "NB-T": SHARE_N }),
  `router: outbound movements are NB through ${SHARE_N} and ONE NB left ${SHARE_W} across both carriageways (${JSON.stringify(outMoves)})`);
ok(JSON.stringify(inMoves) === JSON.stringify({ "EB-R": SHARE_W, "SB-T": SHARE_N }),
  `router: inbound movements are SB through ${SHARE_N} and EB right ${SHARE_W} (${JSON.stringify(inMoves)})`);
// Independent cross-check from the node ledger: trips ENTERING the group from
// outside (no path re-enters this junction).
const inG = new Set(groups[divIdx]);
const entering = (rows) => rows.filter((t) => inG.has(t.node) && !inG.has(other(g, t.inLink, t.node))).reduce((s, t) => s + t.trips, 0);
ok(near(entering(net.turns), sum(gOut), 1e-9) && near(entering(net.turnsInbound), sum(gIn), 1e-9),
  "router: group totals equal the node ledger's flow entering the junction from outside, both directions");
ok(net.conservation.balanced === true, `router: node conservation still balances (max imbalance ${net.conservation.maxImbalance})`);
// Groups are additive: every other field is byte-identical to the run without them.
const { groupTurns: _a, groupTurnsInbound: _b, ...withGroupsRest } = net;
ok(JSON.stringify(withGroupsRest) === JSON.stringify(legacy),
  "router: passing groups changes nothing but the added group ledgers");
ok(legacy.groupTurns === undefined && legacy.groupTurnsInbound === undefined, "router: no groups ⇒ no group ledger fields");

// ---------------------------------------------------------------------------
// 4. Legs: each road's carriageways pair into one two-way leg.
// ---------------------------------------------------------------------------
const inc = incidentLinks(g);
const legsNode = junctionLegsAtNode(g, B, inc);
const legsGroup = junctionLegsAtGroup(g, groups[divIdx], inc);
const describe = (legs) => legs.map((l) => `${card(l.bearingDeg)}:${l.oneWay ?? "2way"}`).sort().join(" ");
ok(describe(legsNode) === "E:2way N:out S:in W:2way",
  `legs: the kept node alone has one arterial direction per side and counts the median link as its west leg (${describe(legsNode)})`);
ok(describe(legsGroup) === "E:2way N:2way S:2way W:2way",
  `legs: the group's legs are four two-way legs, the arterial's carriageways paired (${describe(legsGroup)})`);
const estNode = buildLegEstimate(legsNode, { signalDesignHourVph: 1800 });
const estGroup = buildLegEstimate(legsGroup, { signalDesignHourVph: 1800 });
ok(estGroup.legs.NB.enteringVph === 900 && estGroup.legs.SB.enteringVph === 900,
  `legs: both arterial directions enter the junction with half the design hour (NB ${estGroup.legs.NB.enteringVph}, SB ${estGroup.legs.SB.enteringVph}); the kept node alone gave NB ${estNode.legs.NB?.enteringVph ?? 0}, SB ${estNode.legs.SB?.enteringVph ?? 0}`);

// ---------------------------------------------------------------------------
// 5. Engine E2E on the fixture.
// ---------------------------------------------------------------------------
const SERVER = path.resolve(here, "..");
const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.divided-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.divided-entry.ts");
await writeFile(entryPath, `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`, "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm",
  outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino",
             "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
  banner: { js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);` },
});

// Real-network data for section 6, served through the same mock.
let realSegments = null, realInventory = null;
const REAL = { lat: 26.3725, lon: -81.5565, radiusMi: 6.5, region: "florida_statewide" };
const realRoads = path.resolve(SERVER, "../api-server/src/data/florida-statewide-roads.json.gz");
const realSignals = path.resolve(SERVER, "../api-server/src/data/florida-statewide-signals.json");
if (existsSync(realRoads) && existsSync(realSignals)) {
  const { roadSegmentsNear } = await import(path.resolve(SERVER, "../api-server/src/lib/regional-roads.ts"));
  const { loadRegionalIntersections } = await import(path.resolve(SERVER, "../api-server/src/lib/regional-intersections.ts"));
  realSegments = roadSegmentsNear(REAL.region, REAL.lat, REAL.lon, REAL.radiusMi + 0.25);
  realInventory = loadRegionalIntersections(REAL.region);
}

let mode = "fixture";
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/roads")) {
    const segs = mode === "fixture" ? segments : realSegments;
    return new Response(JSON.stringify({ available: true, segments: segs }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) {
    const inv = mode === "fixture" ? [recA, recB, recW] : realInventory;
    return new Response(JSON.stringify(inv), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};
const { generateTisReport } = await import(bundlePath);

const req = {
  projectName: "Divided junction E2E", address: "Fixture, FL",
  latitude: SITE.lat, longitude: SITE.lon,
  landUseCode: "210", size: 300, openingYear: 2027, studyRadiusMi: 0.75,
  analysisPeriods: ["pm_peak"],
};
const strip = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.generatedAt; return c; };
await generateTisReport({ ...req }); // warm module caches (see verify-conserved-assignment)
const rep = await generateTisReport({ ...req });
const pm = rep.periodReports.find((p) => p.period === "pm_peak");
const row = rep.affectedIntersections.find((ix) => ix.name === recA.name);
ok(rep.conservedAssignment?.enabled === true && rep.conservedAssignment.conservation.balanced === true,
  `engine: conserved assignment ran and balances (max imbalance ${rep.conservedAssignment?.conservation?.maxImbalance})`);
ok(row?.movementSource === "path", `engine: the divided junction resolves to path movements (${row?.movementSource})`);
const shOut = sum(row?.pathTurns ?? []), shIn = sum(row?.pathTurnsIn ?? []);
ok(shOut > 0 && shIn > 0,
  `engine: the divided junction carries outbound (${shOut.toFixed(3)}) AND inbound (${shIn.toFixed(3)}) project trips`);
const inF = pm.inFraction, ext = pm.externalTripsExact;
const expected = Math.round(ext * (shOut * (1 - inF) + shIn * inF));
ok(row.addedTripsPmPeak === expected && row.addedTripsPmPeak >= Math.min(pm.tripGeneration.inTrips, pm.tripGeneration.outTrips),
  `engine: added trips are the blend of both directions (${row.addedTripsPmPeak} = round(${ext.toFixed(1)} × (${shOut.toFixed(3)}×${(1 - inF).toFixed(2)} + ${shIn.toFixed(3)}×${inF.toFixed(2)}))), PM in/out ${pm.tripGeneration.inTrips}/${pm.tripGeneration.outTrips}`);
const mv = row.movements ?? [];
ok(mv.reduce((s, m) => s + m.trips, 0) === row.addedTripsPmPeak, "engine: Σ movement trips === addedTripsPmPeak");
const byDir = { NB: 0, SB: 0, EB: 0, WB: 0 };
for (const m of mv) byDir[m.approach] += m.trips;
ok((row.approaches ?? []).every((a) => a.addedTripsPeak === byDir[a.direction]), "engine: per-approach +Trips cross-foot with the movement rows");
ok(byDir.NB > 0 && byDir.SB > 0, `engine: both arterial approaches carry project trips (NB ${byDir.NB}, SB ${byDir.SB})`);
const legs = Object.fromEntries((row.legVolumes ?? []).map((l) => [l.direction, l]));
ok(legs.NB?.enteringVph > 0 && legs.SB?.enteringVph > 0 && legs.NB.oneWay === null && legs.SB.oneWay === null,
  `engine: both arterial legs are two-way with background volume entering (NB ${legs.NB?.enteringVph}, SB ${legs.SB?.enteringVph})`);
const rep2 = await generateTisReport({ ...req });
ok(JSON.stringify(strip(rep)) === JSON.stringify(strip(rep2)), "engine: deterministic across repeated runs");

// ---------------------------------------------------------------------------
// 6. Real network: Brightshore (Collier FL), the run Datum logged.
// ---------------------------------------------------------------------------
if (!realSegments || !realInventory) {
  console.log("SKIP (LOUD): real-network section — florida-statewide road file or signal inventory not found");
} else {
  mode = "real";
  // A fresh module instance: the engine caches each region's inventory, and
  // the fixture above is in the same region.
  const { generateTisReport: generateReal } = await import(`${pathToFileURL(bundlePath).href}?real`);
  const real = await generateReal({
    projectName: "Brightshore divided-junction check", address: "Collier County, FL",
    latitude: REAL.lat, longitude: REAL.lon, landUseCode: "210", size: 2000, openingYear: 2037,
    studyRadiusMi: REAL.radiusMi, analysisPeriods: ["pm_peak"],
  });
  ok(real.conservedAssignment?.conservation?.balanced === true,
    `Brightshore: conservation balances (max imbalance ${real.conservedAssignment?.conservation?.maxImbalance} over ${real.conservedAssignment?.conservation?.nodesChecked} nodes)`);
  const rpm = real.periodReports.find((p) => p.period === "pm_peak");
  for (const name of [
    "Immokalee Road & 41st Avenue Northeast",
    "Everglades Boulevard North & Oil Well Road",
    "Immokalee Road & Oil Well Road",
    "Immokalee Road & Orange Tree Boulevard",
  ]) {
    const r = real.affectedIntersections.find((ix) => ix.name === name);
    if (!r) { ok(false, `Brightshore: ${name} is in the study`); continue; }
    const o = sum(r.pathTurns ?? []), i = sum(r.pathTurnsIn ?? []);
    const m = r.movements ?? [];
    ok(r.movementSource === "path" && o > 0 && i > 0 && m.reduce((s, x) => s + x.trips, 0) === r.addedTripsPmPeak,
      `Brightshore: ${name} carries both directions — outbound ${(o * rpm.tripGeneration.outTrips).toFixed(0)} of ${rpm.tripGeneration.outTrips}, inbound ${(i * rpm.tripGeneration.inTrips).toFixed(0)} of ${rpm.tripGeneration.inTrips}, row ${r.addedTripsPmPeak} PM trips`);
  }
}

await rm(entryPath, { force: true });
await rm(bundlePath, { force: true });
if (fails > 0) { console.error(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log("\nall divided-junction checks passed");
