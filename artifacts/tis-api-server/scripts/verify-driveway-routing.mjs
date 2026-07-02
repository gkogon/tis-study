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

// ─── E2E: verify tis.ts driveway wiring via generateTisReport ────────────────
// tis.ts uses bundler-resolution imports (no .ts extensions) that Node's native
// type-strip cannot resolve directly. Bundle tis.ts with esbuild into a temp
// file first, then import the bundle — the same approach the production build
// uses, but scoped to the engine module only.
//
// Assertions:
//   (a) A RIRO-driveway request yields at least one intersection whose
//       addedTripsPmPeak is non-zero and the result carries a driveways payload.
//   (b) driveways: [] is byte-identical to the no-driveways baseline.

import { build as esbuild } from "../node_modules/esbuild/lib/main.js";
import { writeFile, unlink } from "node:fs/promises";

// Set a dummy DATABASE_URL before bundling/importing tis.ts so the db module
// doesn't throw at module-evaluation time. tis-calibration.ts connects lazily
// (the pool is created at module level but queries only run on function call);
// generateTisReport falls back to an empty calibration map when the DB is down.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://localhost/tis_e2e_stub_db";
}

// Bundle tis.ts (+ its dependency tree) into a temp file INSIDE the project
// so node can resolve externals (pino, pdfkit…) from the local node_modules.
const bundlePath = path.resolve(here, "../.tis-bundle-e2e.mjs");

// Thin entry that re-exports only what the test needs.
const entryContent = `export { generateTisReport } from ${JSON.stringify(
  path.resolve(here, "../src/lib/tis.ts")
)};`;
const entryPath = path.resolve(here, "../.tis-bundle-entry.ts");
await writeFile(entryPath, entryContent, "utf8");

let bundleOk = false;
try {
  await esbuild({
    entryPoints: [entryPath],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: bundlePath,
    logLevel: "silent",
    // Keep node built-ins external; also keep pdfkit + pino external (native
    // loaders, same as production build) so the bundle doesn't choke.
    external: [
      "*.node", "pdfkit", "fontkit", "pino", "pino-pretty",
      "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3",
      "pg-native", "canvas", "sharp", "ioredis",
    ],
    // Suppress the "Direct eval" warning from pino (not a real issue here).
    banner: {
      js: `import { createRequire as __cr } from 'node:module';
globalThis.require = __cr(import.meta.url);`,
    },
  });
  bundleOk = true;
} catch (buildErr) {
  console.error("esbuild failed:", buildErr.message ?? buildErr);
  fails++;
}

if (bundleOk) {
  // Site just west of Atlanta CBD, Atlanta region.
  const E2E_LAT = 33.749;
  const E2E_LON = -84.3880;

  // Two intersections: one EAST, one WEST (~0.008°lon ≈ 0.4 mi).
  const MOCK_INTS = [
    { id: "sig-E", name: "E Signal", zone: "ATL", latitude: E2E_LAT, longitude: E2E_LON + 0.008, totalVolume: 8000 },
    { id: "sig-W", name: "W Signal", zone: "ATL", latitude: E2E_LAT, longitude: E2E_LON - 0.008, totalVolume: 7000 },
  ];

  // A short E-W road segment through the site.
  const MOCK_ROADS = {
    available: true,
    segments: [[3, E2E_LAT, E2E_LON - 0.015, E2E_LAT, E2E_LON + 0.015, null, null]],
  };

  // RIRO driveway just north of the site on the E-W road.
  const RIRO_DRIVEWAY = {
    id: "dw1", label: "Main Driveway",
    latitude: E2E_LAT + 0.00005, longitude: E2E_LON,
    accessType: "riro",
    movements: { inLeft: false, inRight: true, outLeft: false, outRight: true },
  };

  // Mock global fetch BEFORE importing the bundle so the module-level
  // intersection cache in tis.ts is seeded by our mock on first call.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/atlanta/intersections") || u.includes("/api/intersections")) {
      return new Response(JSON.stringify(MOCK_INTS), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/api/roads")) {
      return new Response(JSON.stringify(MOCK_ROADS), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  let tisModule;
  try {
    tisModule = await import(bundlePath);
  } catch (e) {
    console.error("FATAL: failed to import bundle:", e.message);
    fails++;
  }

  if (tisModule) {
    const { generateTisReport } = tisModule;
    const baseReq = {
      projectName: "E2E Driveway Test",
      address: "Atlanta, GA",
      latitude: E2E_LAT,
      longitude: E2E_LON,
      landUseCode: "220",
      size: 100,
      openingYear: 2027,
      analysisPeriods: ["pm_peak"],
    };

    let baseReport, emptyReport, riroReport;
    try {
      baseReport  = await generateTisReport({ ...baseReq });
      emptyReport = await generateTisReport({ ...baseReq, driveways: [] });
      riroReport  = await generateTisReport({ ...baseReq, driveways: [RIRO_DRIVEWAY] });
    } catch (e) {
      console.error("FATAL: generateTisReport threw:", e.message);
      console.error(e.stack?.slice(0, 800));
      fails++;
    }

    globalThis.fetch = origFetch;

    if (baseReport && emptyReport && riroReport) {
      // (b) driveways: [] opt-in guard: result carries no driveways payload and
      // intersection scores are unchanged vs the no-driveways baseline.
      // (The request echo differs: driveways:[] serializes into req, which is
      // expected and fine — the guard is about *computed* output being unchanged.)
      ok(emptyReport.driveways == null,
        "driveways:[] does NOT produce a driveways result payload (opt-in guard)");
      const baseScores  = JSON.stringify((baseReport.affectedIntersections ?? []).map((r) => ({ id: r.signalId, vc: r.currentVc, added: r.addedTripsPmPeak })));
      const emptyScores = JSON.stringify((emptyReport.affectedIntersections ?? []).map((r) => ({ id: r.signalId, vc: r.currentVc, added: r.addedTripsPmPeak })));
      ok(baseScores === emptyScores,
        "driveways:[] intersection scores are identical to no-driveways baseline");

      // (a) RIRO report carries a driveways payload.
      ok(riroReport.driveways != null,
        "RIRO report carries a driveways result payload");
      ok(Array.isArray(riroReport.driveways?.driveways) && riroReport.driveways.driveways.length > 0,
        "driveways payload has at least one driveway result");
      ok(Array.isArray(riroReport.driveways?.reroutes) && riroReport.driveways.reroutes.length > 0,
        "RIRO report driveways.reroutes is non-empty (U-turn reroutes recorded)");

      // At least one intersection should have a non-zero addedTripsPmPeak
      // (the driveway assignment channels trips through intersections).
      const riroAdded = (riroReport.affectedIntersections ?? []).map((r) => r.addedTripsPmPeak ?? 0);
      ok(riroAdded.some((v) => v > 0),
        `RIRO report has at least one intersection with addedTripsPmPeak > 0 (got [${riroAdded.join(",")}])`);
    }
  }

  // Clean up temp bundle files.
  await unlink(bundlePath).catch(() => {});
  await unlink(entryPath).catch(() => {});
}

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
