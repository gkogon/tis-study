// E2E regression check for the conserved-assignment flag (req.conservedAssignment).
//
// TWO CONTRACTS, in order of importance:
//
//  1. FLAG OFF ⇒ BYTE-IDENTICAL. The flag gates everything; absent or false
//     must produce exactly the legacy payload. This is the promise that lets
//     the feature merge while stored studies and live customers see nothing.
//
//  2. FLAG ON ⇒ the numbers keep their books. At every resolved intersection:
//     Σ integer movement trips === addedTripsPmPeak, and each approach's
//     printed +Trips === Σ of that approach's movement rows (the two integer
//     contracts from movement-assignment). Every intersection with a movements
//     table is labeled movementSource "path" or "octant", the report carries
//     the conservation diagnostics, and the whole thing is deterministic.
//
// Harness mirrors verify-driveway-routing.mjs: esbuild-bundle tis.ts, mock
// global fetch so /api/roads serves the REAL Miami-Dade network from the local
// road file and /api/intersections serves synthetic signals placed ON real
// graph junctions (so the snap resolves) plus one off-network signal (so the
// octant fallback is exercised).
//
// Run: node ./scripts/verify-conserved-assignment.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { writeFile, rm } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

process.env.DATABASE_URL ??= "postgres://localhost/tis_e2e_stub_db";

const { roadSegmentsNear } = await import(path.resolve(here, "../../api-server/src/lib/regional-roads.ts"));
const { buildGraph } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { snapSignalsToJunctions } = await import(path.resolve(here, "../src/lib/cordon-gateways.ts"));
const { GenerateTisResponse } = await import(path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// Site + real network. Pick signal positions that are REAL junctions.
// ---------------------------------------------------------------------------
const SITE = { lat: 25.8456, lon: -80.2103 };
const RADIUS = 0.5;
const segments = roadSegmentsNear("miami_dade_metro", SITE.lat, SITE.lon, RADIUS + 0.25);
ok(segments.length > 300, `real Miami network loaded (${segments.length} segments)`);

const g = buildGraph(segments);
// Find junction nodes 0.1–0.4 mi from the site, spread by taking every Nth.
const dist = (a, b, c, d) => {
  const R = 3958.8, p = Math.PI / 180;
  const s = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const probeSnaps = snapSignalsToJunctions(g, g.nodeLat.map((la, i) => ({ lat: la, lon: g.nodeLon[i] })), { maxMeters: 1 });
const junctionNodes = probeSnaps.flatMap((s, i) => (s.node === i ? [i] : []));
const ringJunctions = junctionNodes.filter((i) => {
  const d = dist(SITE.lat, SITE.lon, g.nodeLat[i], g.nodeLon[i]);
  return d > 0.08 && d < 0.4;
});
ok(ringJunctions.length >= 4, `enough real junctions to place signals on (${ringJunctions.length})`);

const step = Math.max(1, Math.floor(ringJunctions.length / 4));
const onNet = [0, 1, 2, 3].map((k) => ringJunctions[k * step]).filter((v) => v !== undefined);
const MOCK_INTS = onNet.map((n, i) => ({
  id: `sig-${i + 1}`, name: `Junction ${i + 1}`, zone: "MIA",
  latitude: g.nodeLat[n], longitude: g.nodeLon[n], totalVolume: 9000 + i * 800,
}));
// One signal genuinely far (>150 m) from EVERY junction → octant fallback.
// Found programmatically: a guessed offset in dense Miami landed within 100 m
// of a real junction on the first attempt, which is itself a good sign for
// coverage but a bad fixture.
const offNode = g.nodeLat.findIndex((la, i) => {
  const d = dist(SITE.lat, SITE.lon, la, g.nodeLon[i]);
  if (d < 0.08 || d > 0.4) return false;
  return junctionNodes.every((j) => dist(la, g.nodeLon[i], g.nodeLat[j], g.nodeLon[j]) * 1609.34 > 150);
});
ok(offNode >= 0, "found a mid-block point >150 m from every junction");
MOCK_INTS.push({
  id: "sig-off", name: "Off-network signal", zone: "MIA",
  latitude: g.nodeLat[offNode], longitude: g.nodeLon[offNode], totalVolume: 7000,
});

// ---------------------------------------------------------------------------
// Bundle tis.ts with fetch mocked (mock must be installed BEFORE import so the
// module-level intersection cache seeds from it).
// ---------------------------------------------------------------------------
const SERVER = path.resolve(here, "..");
const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.conserved-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.conserved-entry.ts");
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
  projectName: "Conserved E2E", address: "Miami, FL",
  latitude: SITE.lat, longitude: SITE.lon,
  landUseCode: "820", size: 60,
  openingYear: 2027, studyRadiusMi: RADIUS,
  analysisPeriods: ["pm_peak"],
};

const stripTime = (r) => {
  const c = JSON.parse(JSON.stringify(r));
  delete c.generatedAt;
  // The report echoes the request verbatim, so an explicit
  // `conservedAssignment: false` shows up there by construction. That is the
  // request echo, not engine behaviour — normalise it out of the comparison.
  if (c.request && c.request.conservedAssignment === false) delete c.request.conservedAssignment;
  return c;
};

// ---------------------------------------------------------------------------
// 1. Flag off ⇒ byte-identical; no new fields leak.
// ---------------------------------------------------------------------------
// Warm-up: the first generateTisReport call seeds module-level caches
// (intersections, calibration miss) whose fetch ordering can differ from every
// later call. Run one throwaway first so the comparison is cache-stable —
// we are testing the FLAG, not the cache.
await generateTisReport({ ...baseReq });
const legacy = await generateTisReport({ ...baseReq });
const flagFalse = await generateTisReport({ ...baseReq, conservedAssignment: false });
if (JSON.stringify(stripTime(legacy)) !== JSON.stringify(stripTime(flagFalse))) {
  const a = stripTime(legacy), b = stripTime(flagFalse);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.error(`  diff at top-level key: ${k}`);
  }
}
ok(JSON.stringify(stripTime(legacy)) === JSON.stringify(stripTime(flagFalse)),
  "flag absent === flag false (byte-identical)");
ok(legacy.conservedAssignment === undefined, "flag off: no conservedAssignment summary");
ok((legacy.affectedIntersections ?? []).every((ix) => ix.movementSource === undefined),
  "flag off: no movementSource on any intersection");

// ---------------------------------------------------------------------------
// 2. Flag on ⇒ labeled, cross-footed, conserved, deterministic.
// ---------------------------------------------------------------------------
const on = await generateTisReport({ ...baseReq, conservedAssignment: true });
const ca = on.conservedAssignment;
ok(ca?.enabled === true,
  `flag on: summary present (gateways=${ca?.gatewayCount}, ceiling=${ca?.classCeiling}, resolved=${ca?.resolvedIntersections}, fallbacks=${ca?.octantFallbacks})`);
ok(ca?.conservation?.balanced === true,
  `flag on: assignment conserved (max imbalance ${ca?.conservation?.maxImbalance} over ${ca?.conservation?.nodesChecked} nodes)`);
// "Resolved" requires BOTH a junction snap AND at least one routed path
// through that junction — with a top-3-per-octant cordon, side junctions the
// paths never touch legitimately fall back. So the floor here is 1, and the
// summary's split is the honest ledger of the mixed model.
ok(ca?.resolvedIntersections >= 1,
  `flag on: at least one signal resolved to path movements (${ca?.resolvedIntersections}/${MOCK_INTS.length})`);
ok(ca?.octantFallbacks >= 1,
  `flag on: fallbacks recorded for unresolved/unrouted signals (${ca?.octantFallbacks})`);

const rows = on.affectedIntersections ?? [];
let pathRows = 0, octantRows = 0;
for (const ix of rows) {
  const mv = ix.movements ?? [];
  if (mv.length === 0) continue;
  ok(ix.movementSource === "path" || ix.movementSource === "octant",
    `${ix.signalId}: movementSource labeled (${ix.movementSource})`);
  if (ix.movementSource === "path") pathRows++; else octantRows++;

  // Integer contract 1: Σ movement trips === the junction's added trips.
  const mvSum = mv.reduce((s, m) => s + m.trips, 0);
  ok(mvSum === ix.addedTripsPmPeak,
    `${ix.signalId}: Σ movements (${mvSum}) === addedTripsPmPeak (${ix.addedTripsPmPeak}) [${ix.movementSource}]`);

  // Integer contract 2: each approach's +Trips === Σ its movement rows.
  const byDir = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const m of mv) byDir[m.approach] += m.trips;
  const reconciled = (ix.approaches ?? []).every((a) => a.addedTripsPeak === byDir[a.direction]);
  ok(reconciled, `${ix.signalId}: per-approach +Trips cross-foots with movements [${ix.movementSource}]`);
}
ok(pathRows >= 1, `path-derived movement tables produced (${pathRows})`);
ok(octantRows >= 1, `octant fallback tables retained (${octantRows})`);

// The off-network signal specifically must be octant.
const off = rows.find((ix) => ix.signalId === "sig-off");
ok(off === undefined || off.movements === undefined || off.movementSource === "octant",
  `off-network signal is octant-sourced (${off?.movementSource})`);

// Determinism.
const on2 = await generateTisReport({ ...baseReq, conservedAssignment: true });
ok(JSON.stringify(stripTime(on)) === JSON.stringify(stripTime(on2)),
  "flag on: byte-identical across repeated runs");

// ---------------------------------------------------------------------------
// 3. The strip trap: new fields survive the generated zod response schema.
// ---------------------------------------------------------------------------
{
  const parsed = GenerateTisResponse.partial().parse({
    conservedAssignment: ca,
    affectedIntersections: rows.slice(0, 2),
  });
  ok(parsed.conservedAssignment?.conservation?.balanced === true,
    "conservedAssignment summary survives GenerateTisResponse (not stripped)");
  ok(parsed.affectedIntersections?.[0]?.movementSource !== undefined,
    "movementSource survives GenerateTisResponse (not stripped)");
}

await rm(entryPath, { force: true });
await rm(bundlePath, { force: true });
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
