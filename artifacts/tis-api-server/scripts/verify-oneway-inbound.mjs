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
//      output is deterministic.
//   5. Full-strength real one-way data (env ONEWAY_ROADS_FILE, or the in-repo
//      Miami file once the refetch data merges): every ledger row in BOTH
//      directions reconstructs to a legal traversal; ledger totals cross-foot
//      with an independent directed-reachability computation. Skips LOUDLY on
//      pre-rollout data.
//   6. directedReachability screens gateways: unreachable-both-ways flagged,
//      reachable-one-way kept, two-way graphs symmetric.
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

  const MOCK_INTS = [
    { id: "sig-eb-mid", name: "EB-only mid", zone: "MIA", latitude: eLatN, longitude: ex(0.15), totalVolume: 9000 },
    { id: "sig-return", name: "Return-street mid", zone: "MIA", latitude: eLatS, longitude: ex(-0.15), totalVolume: 8600 },
    { id: "sig-eb-west", name: "EB-only west", zone: "MIA", latitude: eLatN, longitude: ex(-0.3), totalVolume: 8200 },
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
      return new Response(JSON.stringify({ available: true, segments: eSegments }), {
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

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
