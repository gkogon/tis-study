// Generates the three REAL fixtures the browser scenario solver is gated on
// (artifacts/atlanta-tis/scripts/fixtures/), by running THIS branch's engine
// — generateTisReport, with Track E2's exact re-solve fields — against the
// live analyzer. Nothing here is synthetic: the signals, roads, volumes and
// UTDF-free timing all come from the same service /generate uses. (The one
// hand-written input is fixture C's Synchro record — its VOLUMES are made up,
// as any client import's are; every row derived from it is the engine's.)
//
//   scenario-base.json         the Peachtree Multifamily request, verbatim
//                              (legVolumes: network by default, so resolved
//                              rows carry legEstimateExact).
//   scenario-overrides.json    the same request + two signalTimingOverrides
//                              (one longer cycle, one protected left) + size x1.5.
//   scenario-network-utdf.json the same request + ONE UTDF record placed
//                              40 m from the nearest studied signal and
//                              within the 0.35 mi snap radius of others: the
//                              engine attaches it to the nearest signal only
//                              (utdf_tmc, utdfRecordIndex 0); its neighbours
//                              stay network-estimated. The client solve must
//                              NOT re-attach that record to a neighbour.
//
// The overrides are built with the CLIENT's own helpers (scenario-solve.ts:
// timingEditFromRow / withCycle / withProtectedLeft / toWhatIfRequest), so
// fixture B is byte-for-byte the body the studio would POST to /tis-api/whatif
// for that scenario state — which is what check:scenario-solve asserts against.
//
// Run: node scripts/make-scenario-fixtures.mjs [--only=network-utdf]
// (from artifacts/tis-api-server). Network: ANALYZER_API_URL (defaults to
// the production analyzer).
//
// --only=network-utdf regenerates fixture C alone (A is still run, unsaved,
// to place C's record). A and B are pinned from a 2026-09-11 run whose rows
// predate legEstimateExact; regenerating them under the current engine
// exposes a rounding-boundary case in check:scenario-solve's documented
// parity exception (the engine re-runs the BPR-fed assignment for B's size
// change, the browser holds the distribution at base; one row's build delay
// then rounds 165.1 vs 165.2). Until that exception is closed, leave A/B
// pinned and regenerate C only.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink, mkdir } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..");
const OUT_DIR = path.resolve(SERVER, "../atlanta-tis/scripts/fixtures");
const SOLVE = path.resolve(SERVER, "../atlanta-tis/src/lib/scenario-solve.ts");

process.env["ANALYZER_API_URL"] ??= "https://simpleimpactstudies.com";
// The engine reads DATABASE_URL at import for the calibration table; the query
// itself fails soft to multiplier 1.0 (same stub as verify-signal-timing-engine).
process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";

// ---- bundle the engine (TS -> one ESM file), the harness pattern ----------
const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const entryPath = path.resolve(SERVER, "src/lib/.fixture-entry.ts");
const bundlePath = path.resolve(SERVER, "src/lib/.fixture-bundle.mjs");
await writeFile(entryPath, `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`, "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm", outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
  banner: { js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);` },
});
const { generateTisReport } = await import(bundlePath);
const { timingEditFromRow, withCycle, withProtectedLeft, toWhatIfRequest, EMPTY_SCENARIO } = await import(SOLVE);

// ---- A: the Peachtree Multifamily request, verbatim ----------------------
const REQUEST = {
  projectName: "Peachtree Multifamily",
  address: "1100 Peachtree St NE, Atlanta, GA 30309",
  latitude: 33.7861,
  longitude: -84.3853,
  landUseCode: "221",
  size: 240,
  openingYear: 2027,
  studyRadiusMi: 0.5,
  analysisPeriods: ["am_peak", "pm_peak", "daily"],
  growthRatePct: 1.5,
  weather: "clear",
  runSensitivity: false,
};

const only = process.argv.slice(2).find((a) => a.startsWith("--only="))?.slice("--only=".length);
if (only !== undefined && only !== "network-utdf") throw new Error(`unknown --only=${only} (supported: network-utdf)`);
const writeAB = only === undefined;

console.log(`analyzer: ${process.env["ANALYZER_API_URL"]}`);
console.log("A: generating the base study ...");
const base = await generateTisReport({ ...REQUEST });
console.log(`   ${base.affectedIntersections.length} studied intersections, periods ${base.periodReports.map((p) => p.period).join("/")}`);

// ---- B: two timing overrides + size x1.5 ---------------------------------
// Two STUDIED rows whose timing the engine actually resolved (a
// screening-default row has no plan to override). Deterministic pick: the two
// nearest such rows, in the engine's own row order.
const candidates = base.affectedIntersections.filter(
  (r) => r.signalTiming && r.signalTiming.basis !== "screening-default",
);
if (candidates.length < 2) throw new Error(`need two rows with resolved timing, found ${candidates.length}`);
const [rowLongCycle, rowProtLeft] = candidates;

const editA = timingEditFromRow(rowLongCycle);
const editB = timingEditFromRow(rowProtLeft);
if (!editA || !editB) throw new Error("could not seed a timing edit from the chosen rows");

const state = {
  ...EMPTY_SCENARIO,
  size: REQUEST.size * 1.5,
  timing: {
    // A longer cycle at the same phase shares.
    [rowLongCycle.signalId]: withCycle(editA, Math.min(300, editA.cycleLenSec + 60)),
    // A protected NS left taken out of the through phases pro rata.
    [rowProtLeft.signalId]: withProtectedLeft(editB, "ns", true),
  },
};
const overrideRequest = toWhatIfRequest(base, state);
const withOverrides = writeAB ? await (async () => {
  console.log(`B: ${rowLongCycle.signalId} cycle ${editA.cycleLenSec}s -> ${overrideRequest.signalTimingOverrides[0].cycleLenSec}s; ` +
    `${rowProtLeft.signalId} protected NS left; size ${REQUEST.size} -> ${overrideRequest.size}`);
  console.log("B: generating the override study ...");
  const r = await generateTisReport({ ...overrideRequest });
  console.log(`   timingOverrideSummary: ${JSON.stringify(r.timingOverrideSummary)}`);
  return r;
})() : undefined;

// ---- C: one UTDF record on a signal with network-estimated neighbours ----
// The record sits 40 m north of the nearest studied signal (row 0 of the
// base run), 4-dp rounded like a real UTDF import. Midtown signals are a
// block apart, so several OTHER studied signals fall inside the engine's
// 0.35 mi snap radius; the engine attaches a coordinate record to its
// nearest candidate ONLY (attachUtdfData), so exactly one row is measured
// and the neighbours keep their leg estimates. check:scenario-solve asserts
// the browser solve leaves those neighbours alone.
const round4 = (n) => Math.round(n * 1e4) / 1e4;
const haversineM = (a, b, c, d) => { const R = 6371000, p = Math.PI / 180; const s = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
const SNAP_MAX_M = 0.35 * 1609.34;
const anchor = base.affectedIntersections[0];
const record = {
  intId: 1,
  name: anchor.name,
  latitude: round4(anchor.latitude + 0.00036),
  longitude: round4(anchor.longitude),
  volumes: { NBL: 90, NBT: 700, NBR: 60, SBL: 80, SBT: 650, SBR: 50, EBL: 40, EBT: 300, EBR: 30, WBL: 40, WBT: 280, WBR: 30 },
};
const byDistance = base.affectedIntersections
  .map((r) => ({ id: r.signalId, m: haversineM(record.latitude, record.longitude, r.latitude, r.longitude) }))
  .sort((x, y) => x.m - y.m);
if (byDistance[0].id !== anchor.signalId) throw new Error(`record's nearest signal is ${byDistance[0].id}, expected ${anchor.signalId}`);
const neighbours = byDistance.slice(1).filter((x) => x.m <= SNAP_MAX_M);
if (neighbours.length === 0) throw new Error("no second studied signal within the 0.35 mi snap radius of the record");
console.log(`C: record ${Math.round(byDistance[0].m)} m from ${anchor.signalId}; ${neighbours.length} other studied signal(s) within ${Math.round(SNAP_MAX_M)} m (nearest ${neighbours[0].id} at ${Math.round(neighbours[0].m)} m)`);
console.log("C: generating the network + UTDF study ...");
const withUtdf = await generateTisReport({ ...REQUEST, utdfIntersections: [record] });
const measuredRows = withUtdf.affectedIntersections.filter((r) => r.volumeSource === "utdf_tmc");
if (measuredRows.length !== 1 || measuredRows[0].signalId !== anchor.signalId) throw new Error(`expected exactly ${anchor.signalId} to be measured, got ${measuredRows.map((r) => r.signalId).join(", ")}`);
console.log(`   measured: ${measuredRows[0].signalId} (utdfRecordIndex ${measuredRows[0].utdfRecordIndex})`);
const estimatedNeighbours = neighbours.filter((n) => withUtdf.affectedIntersections.find((r) => r.signalId === n.id)?.volumeSource === "network_estimate");
if (estimatedNeighbours.length === 0) throw new Error("no neighbour inside the snap radius is network-estimated — the fixture would not exercise the client guard");
console.log(`   ${estimatedNeighbours.length} network-estimated neighbour(s) inside the snap radius`);

// ---- trim + write --------------------------------------------------------
// Keep every period the request asked for, pretty-printed, unless a fixture
// would exceed the 1 MB budget; then compact the JSON (a resolved row under
// legVolumes: network carries legEstimateExact, legVolumes, movementEstimate
// and lane groups — ~15 KB pretty-printed per row per surface, which put the
// 40-row base study at 2.4 MB); if still over, drop everything but
// am_peak/pm_peak (the two the studio and the exactness gate exercise).
// Nothing is ever rounded or dropped from a row: the gate needs every byte.
const MAX_BYTES = 1024 * 1024;
const KEEP = new Set(["am_peak", "pm_peak"]);
function serialize(report) {
  let json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json) <= MAX_BYTES) return { json, note: "" };
  json = JSON.stringify(report);
  if (Buffer.byteLength(json) <= MAX_BYTES) return { json, note: " (compact JSON)" };
  const trimmed = { ...report, periodReports: report.periodReports.filter((p) => KEEP.has(p.period)) };
  json = JSON.stringify(trimmed);
  return { json, note: " (compact JSON, TRIMMED to am_peak/pm_peak)", periods: trimmed.periodReports.length };
}

await mkdir(OUT_DIR, { recursive: true });
const outputs = [...(writeAB ? [["scenario-base", base], ["scenario-overrides", withOverrides]] : []), ["scenario-network-utdf", withUtdf]];
for (const [name, report] of outputs) {
  const { json, note, periods } = serialize(report);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_BYTES) throw new Error(`${name}.json is ${bytes} bytes, over the 1 MB budget even after compacting and trimming`);
  await writeFile(path.join(OUT_DIR, `${name}.json`), json + "\n", "utf8");
  console.log(`wrote ${name}.json — ${(bytes / 1024).toFixed(0)} KB, ${periods ?? report.periodReports.length} periods${note}`);
}

// Provenance beside the fixtures: what produced them and how to redo it.
await writeFile(path.join(OUT_DIR, "README.md"), `# Scenario-solver fixtures

All three files are REAL engine output — \`generateTisReport\` on this branch
(Track E2's exact re-solve fields) against the live analyzer at
\`https://simpleimpactstudies.com\`, each at its own \`generatedAt\`. No engine
value in them is hand-written; the one hand-written INPUT is C's Synchro
record (its volumes are made up, as any client import's are).

A and B are pinned from a 2026-09-11 run, before rows carried
\`legEstimateExact\` (their rows reproduce through the legacy screening path).
C was generated after \`legVolumes: network\` shipped: 39 of its 40 rows carry
\`legEstimateExact\` and reproduce through the fed-back estimate.

| file | what |
| --- | --- |
| \`scenario-base.json\` | The Peachtree Multifamily request, verbatim. |
| \`scenario-overrides.json\` | The same request + two \`signalTimingOverrides\` (one longer cycle, one protected NS left) + \`size\` x1.5. |
| \`scenario-network-utdf.json\` | The same request + ONE \`utdfIntersections\` record 40 m from the nearest studied signal and inside the 0.35 mi snap radius of others: the engine attaches it to that nearest signal only (\`utdf_tmc\`, \`utdfRecordIndex\` 0); the neighbours stay \`network_estimate\`. |

\`scripts/check-scenario-solve.mjs\` asserts \`solveScenario(base, EMPTY)\`
reproduces \`scenario-base.json\` on every printed row field with NO tolerance,
that \`solveScenario(base, <that same scenario state>)\` reproduces
\`scenario-overrides.json\` the same way, and that \`solveScenario(C, EMPTY)\`
reproduces \`scenario-network-utdf.json\` with NO \`utdfAttach\` fallback — the
client must not re-attach the record to a network-estimated neighbour.

Regenerate: \`node ../tis-api-server/scripts/make-scenario-fixtures.mjs
--only=network-utdf\` (from \`artifacts/tis-api-server\`) rewrites C alone;
without the flag A and B are rewritten too — see the script header for why
they are currently left pinned. The overrides in B are built by the client's
own \`toWhatIfRequest\`, so B is exactly what the studio would POST. A fixture
over the 1 MB budget is written as compact JSON and, if still over, trimmed
to the am_peak/pm_peak periods; no row is ever rounded or cut.
`, "utf8");

await unlink(entryPath).catch(() => {});
await unlink(bundlePath).catch(() => {});
console.log("done");
