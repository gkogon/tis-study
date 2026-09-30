// Regression check: INBOUND movements are legal on one-way graphs.
//
// PR #118 made the ROUTER honour one-way links (adjacency-build enforcement),
// but movement attribution still fabricated the inbound/return direction as a
// geometric MIRROR of the outbound turn ledger. On a one-way pair the legal
// return uses the OTHER street, so the mirror implied wrong-way traversal —
// a "left turn against traffic" printed in the Affected-movements table, the
// exact reviewer-visible failure this lane exists to prevent.
//
// The fix routes the return direction for real: a reverse-direction pass over
// the TRANSPOSED adjacency records a second ledger (`turnsInbound`), STRICTLY
// GATED on the graph carrying >=1 one-way link. This script asserts:
//
//   1. One-way pair fixture: inbound movements sit on the RETURN street —
//      zero mirrored wrong-way inbound rows anywhere. FAILS against the
//      mirror behaviour (pre-fix code ignores the inbound ledger and mirrors).
//   2. All-two-way fixture: no inbound pass runs (turnsInbound undefined) and
//      movement rows are byte-identical to the historical mirror algebra.
//   3. Hazard-9 integer contracts survive recorded-inbound rows in the SAME
//      single largest-remainder pass.
//   4. Engine E2E on a synthetic one-way grid: movementSource:"path" rows
//      carry no wrong-way approaches, both printed integer cross-foots hold,
//      output is deterministic. 4b: a single-access site with an outbound-
//      only and an inbound-only ramp on the ring loses no share in either
//      pass (its access junction carries every external trip).
//   5. Full-strength real one-way data (env ONEWAY_ROADS_FILE, or the in-repo
//      Miami file once the refetch data merges): every ledger row in BOTH
//      directions reconstructs to a legal traversal; ledger totals cross-foot
//      with an independent directed-reachability computation. Skips LOUDLY on
//      pre-rollout data.
//   6. directedReachability screens gateways: unreachable-both-ways flagged,
//      reachable-one-way kept, two-way graphs symmetric.
//   7. Gateways one pass cannot reach (a divided road's carriageways): each
//      pass gets gateways it can reach, carries the whole demand across the
//      site cut, and the router loads tripsIn on the inbound pass.
//
// Run: node ./scripts/verify-oneway-inbound.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.DATABASE_URL ??= "postgres://localhost/tis_e2e_stub_db";

const { buildGraph, assignRoutesWithTurns, directedReachability } = await import(
  path.resolve(here, "../src/lib/network-assignment.ts")
);
const { pathMovementLoadsExact, integerizeMovementLoads } = await import(
  path.resolve(here, "../src/lib/movement-assignment.ts")
);
const { roadSegmentsNear } = await import(
  path.resolve(here, "../../api-server/src/lib/regional-roads.ts")
);
const { selectCordonGateways } = await import(path.resolve(here, "../src/lib/cordon-gateways.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- Shared helpers ---------------------------------------------------------
const other = (g, li, v) => (g.links[li].a === v ? g.links[li].b : g.links[li].a);
const bearing = (g, a, b) => {
  const p = Math.PI / 180;
  const y = Math.sin((g.nodeLon[b] - g.nodeLon[a]) * p) * Math.cos(g.nodeLat[b] * p);
  const x = Math.cos(g.nodeLat[a] * p) * Math.sin(g.nodeLat[b] * p)
    - Math.sin(g.nodeLat[a] * p) * Math.cos(g.nodeLat[b] * p)
    * Math.cos((g.nodeLon[b] - g.nodeLon[a]) * p);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
// PathTurnShare rows for one node, exactly as tis.ts builds them.
const sharesAt = (g, rows, node) => rows
  .filter((t) => t.node === node)
  .map((t) => ({
    enterBearingDeg: bearing(g, other(g, t.inLink, t.node), t.node),
    exitBearingDeg: bearing(g, t.node, other(g, t.outLink, t.node)),
    share: t.trips,
  }));
// Wrong-way traversals implied by ledger rows (both legs of every turn).
// Travel orientation is identical for both ledgers: enter `node` on inLink,
// leave on outLink.
const wrongWayCount = (g, rows) => {
  let n = 0;
  for (const t of rows) {
    for (const [li, into] of [[t.inLink, t.node], [t.outLink, other(g, t.outLink, t.node)]]) {
      const lk = g.links[li];
      const from = other(g, li, into);
      if (lk.dir === 1 && !(from === lk.a && into === lk.b)) n++;
      if (lk.dir === -1 && !(from === lk.b && into === lk.a)) n++;
    }
  }
  return n;
};

// --- Fixture grid -----------------------------------------------------------
// 5 columns x 2 one-way streets + two-way cross streets at columns 0, 2, 4:
//
//   N0 ──▶ N1 ──▶ N2 ──▶ N3 ──▶ N4      north street: EASTBOUND only
//   │             │             │       cross streets: two-way
//   S0 ◀── S1 ◀── S2 ◀── S3 ◀── S4      south street: WESTBOUND only
//
// Site at N2. Outbound east rides the north street; the legal RETURN from the
// east comes down at column 4 and rides the SOUTH street back. The mirror
// would instead claim westbound travel on the north street — illegal.
const LAT = 33.75, LON = -84.39, STEP = 0.004;
const latN = LAT + STEP, latS = LAT - STEP;
const col = (i) => LON + (i - 2) * STEP;
const seg = (aLat, aLon, bLat, bLon, dir, name) => [3, aLat, aLon, bLat, bLon, 2, 30, name, dir];
const gridSegments = (northDir, southDir) => [
  // North street west→east emission; dir=1 ⇒ eastbound-only.
  ...[0, 1, 2, 3].map((i) => seg(latN, col(i), latN, col(i + 1), northDir, "North St")),
  // South street ALSO west→east emission; dir=-1 ⇒ westbound-only (b→a).
  ...[0, 1, 2, 3].map((i) => seg(latS, col(i), latS, col(i + 1), southDir, "South St")),
  seg(latN, col(0), latS, col(0), 0, "Cross W"),
  seg(latN, col(2), latS, col(2), 0, "Cross Mid"),
  seg(latN, col(4), latS, col(4), 0, "Cross E"),
];
const SITE = { lat: latN, lon: col(2) };            // exactly N2
const DESTS = [
  { lat: latN, lon: col(4), trips: 0.6 },           // east gateway N4
  { lat: latS, lon: col(0), trips: 0.4 },           // west gateway S0
];

// ---------------------------------------------------------------------------
// 1. One-way pair: inbound is ROUTED, sits on the return street, zero
//    wrong-way rows in either ledger, and ledger totals cross-foot with the
//    gateway shares (explicit — ConservationReport.balanced is trivially true
//    by construction and proves nothing here).
// ---------------------------------------------------------------------------
{
  const segments = gridSegments(1, -1);
  const g = buildGraph(segments);
  const net = assignRoutesWithTurns(SITE, DESTS, segments);
  const siteNode = g.nearestNode(SITE.lat, SITE.lon);

  ok(Array.isArray(net.turnsInbound) && net.turnsInbound.length > 0,
    `one-way grid: inbound pass ran (${net.turnsInbound?.length ?? "undefined"} inbound turn rows)`);
  ok(wrongWayCount(g, net.turns) === 0,
    `one-way grid: outbound ledger has zero wrong-way traversals (${net.turns.length} rows)`);
  ok(wrongWayCount(g, net.turnsInbound ?? []) === 0,
    "one-way grid: inbound ledger has zero wrong-way traversals");

  // Explicit conservation at the site cut: every routed path records exactly
  // one row at its site-adjacent junction (outbound: inLink incident to the
  // site; inbound: outLink incident to the site). Σ === Σ gateway shares.
  const incident = (li) => g.links[li].a === siteNode || g.links[li].b === siteNode;
  const outCut = net.turns.filter((t) => incident(t.inLink)).reduce((s, t) => s + t.trips, 0);
  const inCut = (net.turnsInbound ?? []).filter((t) => incident(t.outLink)).reduce((s, t) => s + t.trips, 0);
  ok(Math.abs(outCut - 1.0) < 1e-9, `one-way grid: Σ outbound ledger at site cut === Σ gateway shares (${outCut.toFixed(6)})`);
  ok(Math.abs(inCut - 1.0) < 1e-9, `one-way grid: Σ inbound ledger at site cut === Σ gateway shares (${inCut.toFixed(6)})`);

  // Movement level, mid-block junction N3 on the EASTBOUND-only street:
  // outbound EB through only. The mirror fabricated a WB through here — the
  // wrong-way row this whole lane forbids. (Pre-fix code ignores the 4th
  // argument and mirrors, so this assert FAILS against the old behaviour.)
  const n3 = g.nodeOf(latN, col(3));
  const rowsN3 = pathMovementLoadsExact(
    sharesAt(g, net.turns, n3), 100, 0.5, sharesAt(g, net.turnsInbound ?? [], n3));
  ok(rowsN3.length === 1 && rowsN3[0].approach === "EB" && rowsN3[0].movement === "T"
    && Math.abs(rowsN3[0].exact - 30) < 1e-9,
    `N3 (EB-only street): outbound EB-T only, exact 30 (got ${JSON.stringify(rowsN3)})`);
  ok(!rowsN3.some((r) => r.approach === "WB"),
    "N3 (EB-only street): NO mirrored wrong-way WB row");

  // Return street junction S3: the inbound flow from the east gateway rides
  // the SOUTH street. Pre-fix there were no rows here at all (nothing
  // outbound to mirror) — the return load simply vanished from this street.
  const s3 = g.nodeOf(latS, col(3));
  const rowsS3 = pathMovementLoadsExact(
    sharesAt(g, net.turns, s3), 100, 0.5, sharesAt(g, net.turnsInbound ?? [], s3));
  ok(rowsS3.length === 1 && rowsS3[0].approach === "WB" && rowsS3[0].movement === "T"
    && Math.abs(rowsS3[0].exact - 30) < 1e-9,
    `S3 (return street): inbound WB-T recorded, exact 30 (got ${JSON.stringify(rowsS3)})`);
}

// ---------------------------------------------------------------------------
// 2. All-two-way: the gate holds (no inbound pass) and the absent-ledger
//    fallback is byte-identical to the historical mirror algebra.
// ---------------------------------------------------------------------------
{
  const segments = gridSegments(0, 0);
  const g = buildGraph(segments);
  ok(g.links.every((lk) => lk.dir === 0), "two-way grid: every link dir=0");
  const net = assignRoutesWithTurns(SITE, [{ lat: latN, lon: col(4), trips: 1.0 }], segments);
  ok(net.turnsInbound === undefined,
    "two-way grid: inbound pass GATED OFF (turnsInbound undefined — mirror path preserved bit-for-bit)");

  const n3 = g.nodeOf(latN, col(3));
  const out = sharesAt(g, net.turns, n3);
  const mirrored = out.map((t) => ({
    enterBearingDeg: (t.exitBearingDeg + 180) % 360,
    exitBearingDeg: (t.enterBearingDeg + 180) % 360,
    share: t.share,
  }));
  const viaFallback = pathMovementLoadsExact(out, 100, 0.3);
  const viaExplicitMirror = pathMovementLoadsExact(out, 100, 0.3, mirrored);
  ok(JSON.stringify(viaFallback) === JSON.stringify(viaExplicitMirror),
    "two-way grid: absent-ledger fallback === explicit mirror, byte-identical movement rows");
  // Pinned golden (hand-derived from the historical mirror algebra): EB
  // through 70 outbound + WB through 30 mirrored inbound.
  ok(JSON.stringify(viaFallback) === JSON.stringify([
    { approach: "EB", movement: "T", exact: 70 },
    { approach: "WB", movement: "T", exact: 30 },
  ]), `two-way grid: golden mirror rows unchanged (got ${JSON.stringify(viaFallback)})`);
}

// ---------------------------------------------------------------------------
// 3. Hazard-9 integer contracts with a recorded inbound ledger: one
//    largest-remainder pass, Σ trips === round(exact junction load).
// ---------------------------------------------------------------------------
{
  const out = [{ enterBearingDeg: 180, exitBearingDeg: 270, share: 0.4 }]; // SB→WB right
  const inn = [{ enterBearingDeg: 270, exitBearingDeg: 0, share: 0.6 }];   // WB→NB right
  const scale = 137, inF = 0.35;
  const exactTotal = scale * (0.4 * (1 - inF) + 0.6 * inF); // 64.39
  const rows = pathMovementLoadsExact(out, scale, inF, inn);
  const sumExact = rows.reduce((s, r) => s + r.exact, 0);
  ok(Math.abs(sumExact - exactTotal) < 1e-9,
    `integer contracts: Σ exact rows (${sumExact.toFixed(4)}) === blended junction load (${exactTotal.toFixed(4)})`);
  const integ = integerizeMovementLoads(rows, exactTotal);
  const sumInt = integ.reduce((s, r) => s + r.trips, 0);
  ok(sumInt === Math.round(exactTotal),
    `integer contracts: Σ integer movement trips (${sumInt}) === round(addedTripsExact) (${Math.round(exactTotal)})`);
}

// ---------------------------------------------------------------------------
// 6 (fast, so run before the engine). directedReachability: the cordon
//    gateway screen's primitive.
// ---------------------------------------------------------------------------
{
  const segments = [
    ...gridSegments(1, -1),
    // One-way island, disconnected from the grid: P → Q only.
    seg(latN, LON + 0.020, latN, LON + 0.024, 1, "Island"),
    // One-way spur INTO the grid: T → N4 only (site can never reach T, but T
    // legally reaches the site) — must be KEPT under the either-direction rule.
    seg(latS - STEP, col(4), latN, col(4), 1, "Spur"),
  ];
  const g = buildGraph(segments);
  const siteNode = g.nearestNode(SITE.lat, SITE.lon);
  const reach = directedReachability(g, siteNode);
  const p = g.nodeOf(latN, LON + 0.020), q = g.nodeOf(latN, LON + 0.024);
  const t = g.nodeOf(latS - STEP, col(4));
  ok(reach.outbound[p] === 0 && reach.inbound[p] === 0 && reach.outbound[q] === 0 && reach.inbound[q] === 0,
    "reachability: disconnected one-way island flagged unreachable BOTH ways (screen would drop it)");
  ok(reach.outbound[t] === 0 && reach.inbound[t] === 1,
    "reachability: one-way spur into the grid is inbound-reachable only (screen keeps it)");
  const n4 = g.nodeOf(latN, col(4)), s0 = g.nodeOf(latS, col(0));
  ok(reach.outbound[n4] === 1 && reach.inbound[n4] === 1 && reach.outbound[s0] === 1 && reach.inbound[s0] === 1,
    "reachability: real gateways reachable both ways on the one-way grid");

  // Two-way graphs: outbound and inbound are identical (the screen can never
  // change behaviour where no one-way link exists).
  const g2 = buildGraph(gridSegments(0, 0));
  const r2 = directedReachability(g2, g2.nearestNode(SITE.lat, SITE.lon));
  let sym = true;
  for (let i = 0; i < g2.nodeLat.length; i++) if (r2.outbound[i] !== r2.inbound[i]) sym = false;
  ok(sym, "reachability: two-way graph is direction-symmetric");
}

// ---------------------------------------------------------------------------
// 4. Engine E2E: synthetic one-way grid through generateTisReport with
//    conservedAssignment on. Mirrors the verify-conserved-assignment harness
//    (esbuild bundle, mocked fetch).
// ---------------------------------------------------------------------------
{
  const E_SITE = { lat: 25.8456, lon: -80.2103 };
  const MI_LON = 0.016064; // deg lon per mile at this latitude
  const MI_LAT = 1 / 69.05;
  const XS = [-0.6, -0.45, -0.3, -0.15, 0, 0.15, 0.3, 0.45, 0.6];
  const eLatN = E_SITE.lat + 0.03 * MI_LAT, eLatS = E_SITE.lat - 0.03 * MI_LAT;
  const ex = (x) => E_SITE.lon + x * MI_LON;
  const eSegments = [];
  for (let i = 0; i < XS.length - 1; i++) {
    eSegments.push([3, eLatN, ex(XS[i]), eLatN, ex(XS[i + 1]), 2, 30, "North One-Way", 1]);
    eSegments.push([3, eLatS, ex(XS[i]), eLatS, ex(XS[i + 1]), 2, 30, "South One-Way", -1]);
  }
  for (const x of XS) eSegments.push([3, eLatN, ex(x), eLatS, ex(x), 2, 30, "Cross", 0]);

  // Second engine fixture (4b below), ~3.9 mi from the grid so neither study
  // area sees the other's signals: a site whose ONLY access is one junction J
  // on Main St (two-way, E-W), with Cross Ave (two-way) north from J to the
  // ring, a one-way Out Ramp from Main St to the ring SSE (outbound pass
  // only) and a one-way In Ramp from the ring SSW onto Main St (inbound pass
  // only). Units are miles from the site F.
  const F = { lat: 25.80, lon: -80.25 };
  const fLat = 1 / 69.05, fLon = 1 / (69.17 * Math.cos(F.lat * Math.PI / 180));
  const fp = (x, y) => [F.lat + y * fLat, F.lon + x * fLon];
  const fs = (cls, a, b, lanes, name, dir) => [cls, a[0], a[1], b[0], b[1], lanes, 48, name, dir];
  const fJ = fp(0, 0.1), fM1 = fp(0.35, 0.1), fM2 = fp(-0.35, 0.1);
  const fSegments = [
    // Listed first and drawn against its travel direction (oneway=-1), so
    // node 0 is the ramp's ring end, from which nothing is reachable:
    // reachability must be rooted at the site, not at whatever node is first.
    fs(2, fp(0.45, -0.55), fM1, 3, "Out Ramp", -1),
    fs(4, fp(0, 0), fJ, 2, "Site Access", 0),
    fs(3, fM2, fJ, 2, "Main St", 0), fs(3, fJ, fM1, 2, "Main St", 0),
    fs(3, fp(-0.7, 0.1), fM2, 2, "Main St", 0), fs(3, fM1, fp(0.7, 0.1), 2, "Main St", 0),
    fs(3, fJ, fp(0, 0.8), 2, "Cross Ave", 0),
    fs(2, fp(-0.45, -0.55), fM2, 3, "In Ramp", 1),
  ];

  // Third engine fixture (4c), all two-way, ~5 mi from the others: the same
  // single-access layout without ramps, plus a two-way fragment on the ring
  // NNE that touches nothing else. On an all-two-way graph no reachability
  // screen runs, so the fragment keeps its slot in the cordon exactly as
  // before this change (and its share is still dropped at routing — the
  // two-way case is deliberately left byte-identical).
  const F2 = { lat: 25.76, lon: -80.30 };
  const f2p = (x, y) => [F2.lat + y * fLat, F2.lon + x * fLon];
  const f2J = f2p(0, 0.1);
  const f2Segments = [
    fs(4, f2p(0, 0), f2J, 2, "Site Access", 0),
    fs(3, f2p(-0.7, 0.1), f2J, 2, "Main St", 0), fs(3, f2J, f2p(0.7, 0.1), 2, "Main St", 0),
    fs(3, f2J, f2p(0, 0.8), 2, "Cross Ave", 0),
    fs(2, f2p(0.1, 0.75), f2p(0.3, 0.9), 3, "Fragment", 0),
  ];

  const MOCK_INTS = [
    { id: "sig-eb-mid", name: "EB-only mid", zone: "MIA", latitude: eLatN, longitude: ex(0.15), totalVolume: 9000 },
    { id: "sig-return", name: "Return-street mid", zone: "MIA", latitude: eLatS, longitude: ex(-0.15), totalVolume: 8600 },
    { id: "sig-eb-west", name: "EB-only west", zone: "MIA", latitude: eLatN, longitude: ex(-0.3), totalVolume: 8200 },
    // 4b: J, plus two unresolved signals SSE and SSW of the site that give
    // the gravity distribution demand in the ramps' octants.
    { id: "sig-access", name: "Main St & Site Access", zone: "MIA", latitude: fJ[0], longitude: fJ[1], totalVolume: 9000 },
    { id: "sig-sse", name: "SSE zone", zone: "MIA", latitude: fp(0.2, -0.35)[0], longitude: fp(0.2, -0.35)[1], totalVolume: 9000 },
    { id: "sig-ssw", name: "SSW zone", zone: "MIA", latitude: fp(-0.2, -0.35)[0], longitude: fp(-0.2, -0.35)[1], totalVolume: 9000 },
    // 4c: its access junction.
    { id: "sig-access-2w", name: "Main St & Site Access (two-way)", zone: "MIA", latitude: f2J[0], longitude: f2J[1], totalVolume: 9000 },
  ];

  const SERVER = path.resolve(here, "..");
  const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
  const bundlePath = path.resolve(SERVER, "src/lib/.oneway-inbound-bundle.mjs");
  const entryPath = path.resolve(SERVER, "src/lib/.oneway-inbound-entry.ts");
  await writeFile(entryPath, `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`, "utf8");
  await esbuild({
    entryPoints: [entryPath], platform: "node", bundle: true, format: "esm",
    outfile: bundlePath, logLevel: "silent",
    external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino",
               "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
    banner: { js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);` },
  });

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/roads")) {
      const qLat = Number(new URL(u).searchParams.get("lat"));
      const segments = Math.abs(qLat - F.lat) < 0.01 ? fSegments
        : Math.abs(qLat - F2.lat) < 0.01 ? f2Segments : eSegments;
      return new Response(JSON.stringify({ available: true, segments }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) {
      return new Response(JSON.stringify(MOCK_INTS), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const { generateTisReport } = await import(bundlePath);
  const baseReq = {
    projectName: "One-way inbound E2E", address: "Miami, FL",
    latitude: E_SITE.lat, longitude: E_SITE.lon,
    landUseCode: "820", size: 60,
    openingYear: 2027, studyRadiusMi: 0.5,
    analysisPeriods: ["pm_peak"],
  };
  const stripTime = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.generatedAt; return c; };

  await generateTisReport({ ...baseReq }); // warm-up (module caches)
  const on = await generateTisReport({ ...baseReq, conservedAssignment: true });
  ok(on.conservedAssignment?.enabled === true,
    `engine: conserved summary present (gateways=${on.conservedAssignment?.gatewayCount}, resolved=${on.conservedAssignment?.resolvedIntersections})`);

  const rows = on.affectedIntersections ?? [];
  const pathIx = rows.filter((ix) => ix.movementSource === "path");
  ok(pathIx.length >= 2, `engine: path-resolved intersections on the one-way grid (${pathIx.length}/${rows.length})`);

  for (const ix of rows) {
    const mv = ix.movements ?? [];
    if (mv.length === 0) continue;
    const mvSum = mv.reduce((s, m) => s + m.trips, 0);
    ok(mvSum === ix.addedTripsPmPeak,
      `engine ${ix.signalId}: Σ movements (${mvSum}) === addedTripsPmPeak (${ix.addedTripsPmPeak}) [${ix.movementSource}]`);
    const byDir = { NB: 0, SB: 0, EB: 0, WB: 0 };
    for (const m of mv) byDir[m.approach] += m.trips;
    ok((ix.approaches ?? []).every((a) => a.addedTripsPeak === byDir[a.direction]),
      `engine ${ix.signalId}: per-approach +Trips cross-foots with movement rows [${ix.movementSource}]`);
  }

  // The wrong-way ban. sig-eb-mid sits on the EASTBOUND-only street: a WB
  // approach row means westbound travel against the one-way (the mirror's
  // exact fabrication); an NB-Left would exit westbound onto it. sig-return
  // sits on the WESTBOUND-only street: EB approach rows and SB-Lefts are the
  // corresponding violations. Pre-fix, the mirror printed those rows.
  const ebMid = rows.find((ix) => ix.signalId === "sig-eb-mid");
  ok(ebMid?.movementSource === "path" && (ebMid.movements ?? []).length > 0,
    `engine sig-eb-mid: path-resolved with movements (${ebMid?.movementSource}, ${(ebMid?.movements ?? []).length} rows)`);
  ok(!(ebMid?.movements ?? []).some((m) => m.approach === "WB" || (m.approach === "NB" && m.movement === "L")),
    "engine sig-eb-mid (EB-only street): NO wrong-way WB approach / NB-Left rows");
  const ret = rows.find((ix) => ix.signalId === "sig-return");
  ok(!(ret?.movements ?? []).some((m) => m.approach === "EB" || (m.approach === "SB" && m.movement === "L")),
    "engine sig-return (WB-only street): NO wrong-way EB approach / SB-Left rows");
  ok((ret?.movements ?? []).some((m) => m.approach === "WB"),
    "engine sig-return: return-street WB flow present (the load the mirror misplaced)");

  const on2 = await generateTisReport({ ...baseReq, conservedAssignment: true });
  ok(JSON.stringify(stripTime(on)) === JSON.stringify(stripTime(on2)),
    "engine: deterministic across repeated runs");

  // Conserved assignment defaults ON since #122 — the legacy path needs an
  // EXPLICIT false now.
  const off = await generateTisReport({ ...baseReq, conservedAssignment: false });
  ok(off.conservedAssignment === undefined
    && (off.affectedIntersections ?? []).every((ix) => ix.movementSource === undefined),
    "engine: explicit conservedAssignment:false — legacy path, no conserved fields");

  // Reachability screen, end to end. A 5-lane one-way motorway fragment
  // crosses the ENE ring with no connection to the grid (a fetch clipped at
  // the ring does this); its nodes outrank the grid's ENE ring nodes. tis.ts
  // must screen it out as a CANDIDATE, so adding it changes no conserved
  // output. Screening only the finished selection dropped its slots with no
  // backfill; not screening hands them to nodes no path reaches. A fresh
  // module instance (?island) gets a fresh road memo.
  const islandLat = E_SITE.lat + 0.1 * MI_LAT;
  const island = [
    [0, islandLat, ex(0.48), islandLat + 0.02 * MI_LAT, ex(0.52), 5, 113, "Fragment", 1],
    [0, islandLat + 0.02 * MI_LAT, ex(0.52), islandLat + 0.04 * MI_LAT, ex(0.56), 5, 113, "Fragment", 1],
  ];
  eSegments.push(...island);
  const fresh = await import(`${pathToFileURL(bundlePath).href}?island`);
  await fresh.generateTisReport({ ...baseReq }); // warm-up, as above
  const withIsland = await fresh.generateTisReport({ ...baseReq, conservedAssignment: true });
  eSegments.splice(eSegments.length - island.length, island.length);
  const conservedView = (r) => JSON.stringify({
    ca: r.conservedAssignment,
    ix: (r.affectedIntersections ?? []).map((ix) => ({
      id: ix.signalId, src: ix.movementSource, t: ix.addedTripsPmPeak, mv: ix.movements, ap: ix.approaches,
    })),
  });
  ok(withIsland.conservedAssignment?.enabled === true
      && conservedView(withIsland) === conservedView(on),
    `engine: an unreachable one-way fragment on the ring changes no conserved output (gateways ${on.conservedAssignment?.gatewayCount} → ${withIsland.conservedAssignment?.gatewayCount})`);

  // 4b. Single-access site with one-direction ramps on the ring. Every
  //     project trip, in both directions, crosses J, so J's path load is the
  //     whole of the period's external trips: loadWeight (Σout + Σin) / 2 = 1,
  //     the NB approach (leaving the site) carries every outbound trip and
  //     the rest (arriving) every inbound trip. The old cordon gave the Out
  //     Ramp inbound share and the In Ramp outbound share, and the router
  //     dropped both: at J that was 188 of 226 PM trips, weight 0.834.
  {
    const fRep = await generateTisReport({ ...baseReq, projectName: "Single access E2E",
      latitude: F.lat, longitude: F.lon });
    const pmTg = (fRep.periodReports ?? []).find((p) => p.period === "pm_peak")?.tripGeneration;
    const fDir = fRep.tripDistribution?.byDirection ?? {};
    ok(fDir.SSE > 0 && fDir.SSW > 0,
      `engine 4b: the distribution puts demand in both ramps' octants (SSE ${fDir.SSE?.toFixed(1)}%, SSW ${fDir.SSW?.toFixed(1)}%)`);
    const j = (fRep.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-access");
    ok(j?.movementSource === "path", `engine 4b: J is path-resolved (${j?.movementSource})`);
    ok(Math.abs((j?.loadWeight ?? 0) - 1) < 1e-9,
      `engine 4b: J's weight (Σout + Σin) / 2 is 1 (got ${j?.loadWeight})`);
    ok(j?.addedTripsPmPeak === pmTg?.externalTrips,
      `engine 4b: J carries every PM external trip (${j?.addedTripsPmPeak} of ${pmTg?.externalTrips})`);
    const exactOut = (j?.movementsExact ?? []).filter((m) => m.approach === "NB").reduce((s, m) => s + m.exact, 0);
    const exactIn = (j?.movementsExact ?? []).filter((m) => m.approach !== "NB").reduce((s, m) => s + m.exact, 0);
    ok(Math.abs(exactOut - pmTg?.outTrips) < 1 && Math.abs(exactIn - pmTg?.inTrips) < 1,
      `engine 4b: J's outbound rows carry all ${pmTg?.outTrips} outbound trips (${exactOut.toFixed(2)}), the rest all ${pmTg?.inTrips} inbound (${exactIn.toFixed(2)})`);
  }

  // 4c. All-two-way graph: the engine's cordon is the unscreened selection.
  {
    const rep2 = await generateTisReport({ ...baseReq, projectName: "Two-way gate E2E",
      latitude: F2.lat, longitude: F2.lon });
    const g2 = buildGraph(f2Segments);
    ok(g2.links.every((lk) => lk.dir === 0), "engine 4c: fixture is all two-way");
    const plain = selectCordonGateways(g2, F2, 0.5, rep2.tripDistribution.byDirection);
    const frag = g2.nodeOf(...f2p(0.1, 0.75));
    ok(plain?.gateways.some((gw) => gw.node === frag),
      `engine 4c: the unscreened cordon includes the unconnected fragment (${plain?.gateways.length} gateways)`);
    ok(rep2.conservedAssignment?.gatewayCount === plain?.gateways.length
      && JSON.stringify(rep2.conservedAssignment?.emptyOctants) === JSON.stringify(plain?.emptyOctants),
      `engine 4c: the engine ran no reachability screen (gateways ${rep2.conservedAssignment?.gatewayCount} === ${plain?.gateways.length})`);
  }

  await rm(entryPath, { force: true });
  await rm(bundlePath, { force: true });
}

// ---------------------------------------------------------------------------
// 5. Full-strength real one-way data. ONEWAY_ROADS_FILE points at a raw
//    <slug>-roads.json (e.g. extracted from the refetch branch via git show);
//    otherwise the in-repo Miami file is probed and this section skips LOUDLY
//    on pre-rollout (oneway-free) data.
// ---------------------------------------------------------------------------
{
  const M_SITE = { lat: 25.7743, lon: -80.1937 }; // downtown Miami one-way grid
  const RADIUS = 1.0;
  let segments = null, source = "";
  const file = process.env.ONEWAY_ROADS_FILE;
  if (file) {
    // Same shape handling as regional-roads.ts (legacy vs named, oneway at
    // named slot 5), radial keep within RADIUS, no cap (probe rig).
    const road = JSON.parse(readFileSync(file, "utf8"));
    const dMi = (a, b, c, d) => {
      const R = 3958.8, p = Math.PI / 180;
      const s = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };
    const out = [];
    for (const way of road.ways) {
      const named = !Array.isArray(way[1]);
      const pts = named ? way[2] : way[1];
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const cls = typeof way[0] === "number" ? way[0] : 99;
      const lanes = typeof (named ? way[3] : way[2]) === "number" ? (named ? way[3] : way[2]) : null;
      const maxs = typeof (named ? way[4] : way[3]) === "number" ? (named ? way[4] : way[3]) : null;
      const name = named && typeof way[1] === "string" ? way[1] : null;
      const oneway = typeof (named ? way[5] : undefined) === "number" ? way[5] : 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (Math.min(dMi(M_SITE.lat, M_SITE.lon, a[0], a[1]), dMi(M_SITE.lat, M_SITE.lon, b[0], b[1])) <= RADIUS) {
          out.push([cls, a[0], a[1], b[0], b[1], lanes, maxs, name, oneway]);
        }
      }
    }
    segments = out;
    source = `ONEWAY_ROADS_FILE (${path.basename(file)})`;
  } else {
    segments = roadSegmentsNear("miami_dade_metro", M_SITE.lat, M_SITE.lon, RADIUS) ?? [];
    source = "in-repo miami_dade_metro";
  }

  const g = buildGraph(segments);
  const oneWay = g.links.filter((lk) => lk.dir !== 0).length;
  if (oneWay === 0) {
    console.log(`SKIP: ${source} carries no oneway tags (pre-rollout data) — full-strength section covered by the fixtures above; set ONEWAY_ROADS_FILE to the refetch-branch miami file to run it, and it runs automatically once that data merges`);
  } else {
    ok(oneWay > 500, `${source}: real one-way links loaded (${oneWay}/${g.links.length})`);
    const dests = [];
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * 2 * Math.PI;
      dests.push({ lat: M_SITE.lat + 0.008 * Math.cos(th), lon: M_SITE.lon + 0.008 * Math.sin(th), trips: 25 });
    }
    const net = assignRoutesWithTurns(M_SITE, dests, segments);
    ok(net.assignment.available, `full-strength: assignment ran (${net.assignment.onNetworkPct}% on-network)`);
    ok(Array.isArray(net.turnsInbound) && net.turnsInbound.length > 0,
      `full-strength: inbound pass ran (${net.turnsInbound?.length ?? 0} rows vs ${net.turns.length} outbound)`);
    ok(wrongWayCount(g, net.turns) === 0,
      `full-strength: zero wrong-way traversals in ${net.turns.length} outbound ledger rows`);
    ok(wrongWayCount(g, net.turnsInbound ?? []) === 0,
      `full-strength: zero wrong-way traversals in ${(net.turnsInbound ?? []).length} inbound ledger rows`);

    // Cross-foot ledger totals against an INDEPENDENT directed-reachability
    // computation: every routed path records exactly one row at its
    // site-adjacent junction, so the site-cut totals must equal the summed
    // demand of the gateways reachable in that direction (gateways snapped
    // adjacent to the site record no turns; none are, at this ring size).
    const siteNode = g.nearestNode(M_SITE.lat, M_SITE.lon);
    const reach = directedReachability(g, siteNode);
    const destNodes = dests.map((d) => ({ node: g.nearestNode(d.lat, d.lon), trips: d.trips }));
    const adjacent = destNodes.some((d) =>
      g.links.some((lk) => (lk.a === siteNode && lk.b === d.node) || (lk.b === siteNode && lk.a === d.node)));
    ok(!adjacent, "full-strength: no gateway is site-adjacent (site-cut cross-foot applies)");
    const outDemand = destNodes.filter((d) => reach.outbound[d.node] === 1).reduce((s, d) => s + d.trips, 0);
    const inDemand = destNodes.filter((d) => reach.inbound[d.node] === 1).reduce((s, d) => s + d.trips, 0);
    const incident = (li) => g.links[li].a === siteNode || g.links[li].b === siteNode;
    const outCut = net.turns.filter((t) => incident(t.inLink)).reduce((s, t) => s + t.trips, 0);
    const inCut = (net.turnsInbound ?? []).filter((t) => incident(t.outLink)).reduce((s, t) => s + t.trips, 0);
    ok(Math.abs(outCut - outDemand) < 1e-6,
      `full-strength: Σ outbound site-cut ledger (${outCut.toFixed(4)}) === Σ outbound-reachable gateway demand (${outDemand})`);
    ok(Math.abs(inCut - inDemand) < 1e-6,
      `full-strength: Σ inbound site-cut ledger (${inCut.toFixed(4)}) === Σ inbound-reachable gateway demand (${inDemand})`);
  }
}

// ---------------------------------------------------------------------------
// 7. A gateway one pass cannot reach. The router drops the share of a
//    gateway its pass cannot reach, with no renormalisation, so each pass
//    must be given only gateways it can reach. A divided road leaving to the
//    ENE: its eastbound carriageway ends at the ring (Eo: the outbound pass
//    reaches it, nothing leads back), its westbound carriageway starts there
//    (Ei: it reaches the site, the site cannot reach it). Two-way arms go to
//    N, S and W tips. Distribution NNE 20 / ENE 50 / SSW 20 / WNW 10.
//
//                Nt                     Eo  (ENE, outbound only)
//                |          P1 ──────▶ ╱
//         Wt ─── C ════════╡              (EB C→P1→Eo, WB Ei→P2→C)
//                |          P2 ◀────── ╲
//                St                     Ei  (ENE, inbound only)
//
//    Hand answer: outbound Nt .2, Eo .5, St .2, Wt .1; inbound Nt .2, Ei .5,
//    St .2, Wt .1; each pass carries 1.0 across the site cut, and the whole
//    ENE share (.5) crosses P1 outbound and P2 inbound. The old cordon split
//    ENE .25/.25 over Eo and Ei in BOTH passes, so each pass lost .25.
// ---------------------------------------------------------------------------
{
  const s7 = (a, b, dir, name) => [3, a[0], a[1], b[0], b[1], 2, 48, name, dir];
  const C = [LAT, LON];
  const Nm = [LAT + 0.004, LON], Nt = [LAT + 0.01, LON];
  const Sm = [LAT - 0.004, LON], St = [LAT - 0.01, LON];
  const Wm = [LAT, LON - 0.005], Wt = [LAT, LON - 0.01];
  const P1 = [LAT + 0.0027, LON + 0.005], Eo = [LAT + 0.0052, LON + 0.010];
  const P2 = [LAT + 0.0023, LON + 0.005], Ei = [LAT + 0.0048, LON + 0.010];
  const segments = [
    s7(C, Nm, 0, "North Rd"), s7(Nm, Nt, 0, "North Rd"),
    s7(C, Sm, 0, "South Rd"), s7(Sm, St, 0, "South Rd"),
    s7(C, Wm, 0, "West Rd"), s7(Wm, Wt, 0, "West Rd"),
    s7(C, P1, 1, "Divided Rd EB"), s7(P1, Eo, 1, "Divided Rd EB"),
    s7(Ei, P2, 1, "Divided Rd WB"), s7(P2, C, 1, "Divided Rd WB"),
  ];
  const SITE7 = { lat: C[0], lon: C[1] };
  const g = buildGraph(segments);
  const node = (p) => g.nodeOf(p[0], p[1]);
  const siteNode = g.nearestNode(SITE7.lat, SITE7.lon);
  const reach = directedReachability(g, siteNode);
  ok(reach.outbound[node(Eo)] === 1 && reach.inbound[node(Eo)] === 0
    && reach.outbound[node(Ei)] === 0 && reach.inbound[node(Ei)] === 1,
    "divided road: Eo is outbound-only, Ei inbound-only");

  const dirs = { NNE: 20, ENE: 50, ESE: 0, SSE: 0, SSW: 20, WSW: 0, WNW: 10, NNW: 0 };
  const sel = selectCordonGateways(g, SITE7, 0.5, dirs, reach);
  const byNode = (key) => Object.fromEntries((sel?.gateways ?? [])
    .filter((gw) => (gw[key] ?? gw.share) > 0)
    .map((gw) => [gw.node, Math.round((gw[key] ?? gw.share) * 1e9) / 1e9]));
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  ok(same(byNode("share"), { [node(Nt)]: 0.2, [node(Eo)]: 0.5, [node(St)]: 0.2, [node(Wt)]: 0.1 }),
    `divided road: outbound shares Nt .2, Eo .5, St .2, Wt .1 (got ${JSON.stringify(byNode("share"))})`);
  ok(same(byNode("shareIn"), { [node(Nt)]: 0.2, [node(Ei)]: 0.5, [node(St)]: 0.2, [node(Wt)]: 0.1 }),
    `divided road: inbound shares Nt .2, Ei .5, St .2, Wt .1 (got ${JSON.stringify(byNode("shareIn"))})`);

  // Route exactly as tis.ts does and sum each ledger at the site cut.
  const incident = (li) => g.links[li].a === siteNode || g.links[li].b === siteNode;
  const cut = (net) => ({
    out: net.turns.filter((t) => incident(t.inLink)).reduce((s, t) => s + t.trips, 0),
    in: (net.turnsInbound ?? []).filter((t) => incident(t.outLink)).reduce((s, t) => s + t.trips, 0),
  });
  const through = (rows, p) => rows.filter((t) => t.node === node(p)).reduce((s, t) => s + t.trips, 0);
  const net = assignRoutesWithTurns(SITE7, (sel?.gateways ?? []).map((gw) => ({
    lat: gw.lat, lon: gw.lon, trips: gw.share, ...(gw.shareIn !== undefined ? { tripsIn: gw.shareIn } : {}),
  })), segments);
  const c = cut(net);
  ok(Math.abs(c.out - 1) < 1e-9 && Math.abs(c.in - 1) < 1e-9,
    `divided road: each pass carries the whole demand across the site cut (out ${c.out.toFixed(6)}, in ${c.in.toFixed(6)})`);
  ok(Math.abs(through(net.turns, P1) - 0.5) < 1e-9 && Math.abs(through(net.turnsInbound ?? [], P2) - 0.5) < 1e-9,
    `divided road: ENE's .5 crosses P1 outbound and P2 inbound (P1 ${through(net.turns, P1).toFixed(6)}, P2 ${through(net.turnsInbound ?? [], P2).toFixed(6)})`);

  // The router on its own: the inbound pass loads tripsIn, the outbound pass
  // trips, per destination.
  const raw = assignRoutesWithTurns(SITE7, [
    { lat: Eo[0], lon: Eo[1], trips: 0.5, tripsIn: 0 },
    { lat: Ei[0], lon: Ei[1], trips: 0, tripsIn: 0.5 },
  ], segments);
  const rc = cut(raw);
  ok(Math.abs(rc.out - 0.5) < 1e-9 && Math.abs(rc.in - 0.5) < 1e-9
    && Math.abs(through(raw.turnsInbound ?? [], P2) - 0.5) < 1e-9,
    `router: outbound pass loads trips, inbound pass loads tripsIn (out ${rc.out.toFixed(6)}, in ${rc.in.toFixed(6)}, P2 ${through(raw.turnsInbound ?? [], P2).toFixed(6)})`);

  // 7b. The inbound pass's congestion is loaded with tripsIn too. A gateway G
  //     reaches the site by two mirror-image one-way routes, via U1 (north)
  //     or U2 (south), and sends 1000 trips inbound, 0 outbound. Four MSA
  //     iterations, each all-or-nothing onto the currently quicker route
  //     (ties either way): T on one route; then T on the other, blend ½ →
  //     T/2 each; tie, blend ⅓ → 2T/3 and T/3; the lighter one, blend ¼ →
  //     T/2 each. So 500 through U1 and 500 through U2. Loading the pass's
  //     congestion with the outbound 0 instead leaves every iteration an
  //     uncongested all-or-nothing: 1000 on one route.
  {
    const G = [LAT, LON + 0.01], U1 = [LAT + 0.002, LON + 0.005], U2 = [LAT - 0.002, LON + 0.005];
    const twin = [
      s7(C, [LAT, LON - 0.005], 0, "Stub"),
      s7(G, U1, 1, "North Route"), s7(U1, C, 1, "North Route"),
      s7(G, U2, 1, "South Route"), s7(U2, C, 1, "South Route"),
    ];
    const gt = buildGraph(twin);
    const tnet = assignRoutesWithTurns(SITE7, [{ lat: G[0], lon: G[1], trips: 0, tripsIn: 1000 }], twin);
    const at = (p) => (tnet.turnsInbound ?? []).filter((t) => t.node === gt.nodeOf(p[0], p[1])).reduce((s, t) => s + t.trips, 0);
    ok(Math.abs(at(U1) - 500) < 1e-6 && Math.abs(at(U2) - 500) < 1e-6,
      `router: the inbound pass's congestion splits tripsIn 1000 over twin routes 500/500 (U1 ${at(U1).toFixed(3)}, U2 ${at(U2).toFixed(3)})`);
  }
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
