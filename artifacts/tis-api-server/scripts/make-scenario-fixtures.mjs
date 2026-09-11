// Generates the two REAL fixtures the browser scenario solver is gated on
// (artifacts/atlanta-tis/scripts/fixtures/), by running THIS branch's engine
// — generateTisReport, with Track E2's exact re-solve fields — against the
// live analyzer. Nothing here is synthetic: the signals, roads, volumes and
// UTDF-free timing all come from the same service /generate uses.
//
//   scenario-base.json      the Peachtree Multifamily request, verbatim.
//   scenario-overrides.json the same request + two signalTimingOverrides
//                           (one longer cycle, one protected left) + size x1.5.
//
// The overrides are built with the CLIENT's own helpers (scenario-solve.ts:
// timingEditFromRow / withCycle / withProtectedLeft / toWhatIfRequest), so
// fixture B is byte-for-byte the body the studio would POST to /tis-api/whatif
// for that scenario state — which is what check:scenario-solve asserts against.
//
// Run: node scripts/make-scenario-fixtures.mjs   (from artifacts/tis-api-server)
// Network: ANALYZER_API_URL (defaults to the production analyzer).
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
console.log(`B: ${rowLongCycle.signalId} cycle ${editA.cycleLenSec}s -> ${overrideRequest.signalTimingOverrides[0].cycleLenSec}s; ` +
  `${rowProtLeft.signalId} protected NS left; size ${REQUEST.size} -> ${overrideRequest.size}`);
console.log("B: generating the override study ...");
const withOverrides = await generateTisReport({ ...overrideRequest });
console.log(`   timingOverrideSummary: ${JSON.stringify(withOverrides.timingOverrideSummary)}`);

// ---- trim + write --------------------------------------------------------
// Keep every period the request asked for unless a fixture would exceed the
// 1 MB budget; then drop everything but am_peak/pm_peak (the two the studio
// and the exactness gate exercise) and say so in the header comment.
const MAX_BYTES = 1024 * 1024;
const KEEP = new Set(["am_peak", "pm_peak"]);
function serialize(report) {
  let json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json) <= MAX_BYTES) return { json, trimmed: false };
  const trimmed = { ...report, periodReports: report.periodReports.filter((p) => KEEP.has(p.period)) };
  json = JSON.stringify(trimmed, null, 2);
  return { json, trimmed: true };
}

await mkdir(OUT_DIR, { recursive: true });
for (const [name, report] of [["scenario-base", base], ["scenario-overrides", withOverrides]]) {
  const { json, trimmed } = serialize(report);
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_BYTES) throw new Error(`${name}.json is ${bytes} bytes, over the 1 MB budget even after trimming`);
  await writeFile(path.join(OUT_DIR, `${name}.json`), json + "\n", "utf8");
  console.log(`wrote ${name}.json — ${(bytes / 1024).toFixed(0)} KB, ${report.periodReports.length} periods${trimmed ? " (TRIMMED to am_peak/pm_peak)" : ""}`);
}

// Provenance beside the fixtures: what produced them and how to redo it.
await writeFile(path.join(OUT_DIR, "README.md"), `# Scenario-solver fixtures

Both files are REAL engine output — \`generateTisReport\` on this branch (Track
E2's exact re-solve fields) against the live analyzer at
\`https://simpleimpactstudies.com\`. No value in them is hand-written.

| file | what |
| --- | --- |
| \`scenario-base.json\` | The Peachtree Multifamily request, verbatim. |
| \`scenario-overrides.json\` | The same request + two \`signalTimingOverrides\` (one longer cycle, one protected NS left) + \`size\` x1.5. |

\`scripts/check-scenario-solve.mjs\` asserts \`solveScenario(base, EMPTY)\`
reproduces \`scenario-base.json\` on every printed row field with NO tolerance,
and that \`solveScenario(base, <that same scenario state>)\` reproduces
\`scenario-overrides.json\` the same way.

Regenerate: \`node ../tis-api-server/scripts/make-scenario-fixtures.mjs\`
(from \`artifacts/tis-api-server\`). The overrides in B are built by the
client's own \`toWhatIfRequest\`, so B is exactly what the studio would POST.
`, "utf8");

await unlink(entryPath).catch(() => {});
await unlink(bundlePath).catch(() => {});
console.log("done");
