/**
 * UX guard: a study whose site coordinate has NO signalized intersection
 * within the study radius must NOT silently return an empty "0 intersections"
 * report. That case is almost always a bad geocode — the coordinate resolved
 * to open water (e.g. Biscayne Bay) or an area outside our signal coverage —
 * not a genuine finding. The engine + routes surface a coverage warning so a
 * user (or a live sales demo) sees a clear "verify the site location" message
 * instead of a report that looks broken.
 *
 * This asserts the two PURE helpers the engine composes to make that decision,
 * exercised with the exact reproduction coordinates from the field report:
 *   - Bay / off-grid  (25.782,  -80.155 ) → 0 signals in radius → WARN
 *   - Real downtown   (25.7743, -80.1937) → several signals     → no warn
 * against a synthetic downtown-Miami signal inventory (no analyzer network
 * needed, so this stays a deterministic guard like the other check scripts).
 *
 * No test runner is configured in this package, so this is a standalone node
 * script. Run with `pnpm run check:coverage-warning` (Node >= 23, native TS).
 * Exits non-zero on the first failed invariant.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// The helpers live in this small, dependency-free leaf module (imported by
// tis.ts) so plain `node` can load them — importing tis.ts directly would drag
// in the whole engine's extensionless-.ts import graph, which the native TS
// loader can't resolve.
const mod = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const { intersectionsWithinRadius, coverageWarningForCandidates } = mod;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// --- The reproduction coordinates from the field report ------------------
const DOWNTOWN = { lat: 25.7743, lon: -80.1937 }; // real downtown Miami → 5 signals
const BAY = { lat: 25.782, lon: -80.155 };        // Biscayne Bay open water → 0 signals
const RADIUS_MI = 0.5;

// Synthetic downtown-Miami signal inventory: six signals clustered on the
// grid within ~0.4 mi of DOWNTOWN, each >45m apart so the close-signal dedup
// keeps them distinct. All are ~2.5 mi from BAY, so the bay coordinate finds
// none within a 0.5-mi radius — exactly the reported behavior.
const inventory = [
  { id: "s1", name: "Biscayne Blvd & NE 1st St", zone: "cbd", latitude: 25.7743, longitude: -80.1937, totalVolume: 32000 },
  { id: "s2", name: "Biscayne Blvd & NE 3rd St", zone: "cbd", latitude: 25.7761, longitude: -80.1936, totalVolume: 28000 },
  { id: "s3", name: "NE 2nd Ave & NE 1st St", zone: "cbd", latitude: 25.7744, longitude: -80.1919, totalVolume: 21000 },
  { id: "s4", name: "N Miami Ave & NW 1st St", zone: "cbd", latitude: 25.7745, longitude: -80.1957, totalVolume: 18000 },
  { id: "s5", name: "SE 2nd St & Brickell Ave", zone: "cbd", latitude: 25.7722, longitude: -80.1920, totalVolume: 24000 },
  { id: "s6", name: "NW 3rd St & NW 1st Ave", zone: "cbd", latitude: 25.7758, longitude: -80.1959, totalVolume: 15000 },
];

// --- API surface ---------------------------------------------------------
ok(typeof intersectionsWithinRadius === "function", "intersectionsWithinRadius is exported");
ok(typeof coverageWarningForCandidates === "function", "coverageWarningForCandidates is exported");

// --- Bay / off-grid coordinate: 0 in radius → warning --------------------
const bayCandidates = intersectionsWithinRadius(inventory, BAY.lat, BAY.lon, RADIUS_MI);
ok(bayCandidates.length === 0, "bay coordinate resolves 0 signals within the study radius");

const bayWarn = coverageWarningForCandidates(bayCandidates.length, RADIUS_MI);
ok(!!bayWarn, "0-candidate case returns a coverage warning (not undefined)");
ok(bayWarn && bayWarn.code === "no_signals_in_radius", 'warning code is "no_signals_in_radius"');
ok(bayWarn && bayWarn.radiusMi === RADIUS_MI, "warning carries the study radius");
ok(bayWarn && /within 0\.5\s*mi/i.test(bayWarn.message), "warning message states the radius (0.5 mi)");
ok(bayWarn && /water|don't cover|do not cover/i.test(bayWarn.message), "warning message names the likely cause (water / out of coverage)");
ok(bayWarn && /verify the site/i.test(bayWarn.message), 'warning message tells the user to "verify the site location"');

// --- Real downtown coordinate: several in radius → no warning ------------
const dtCandidates = intersectionsWithinRadius(inventory, DOWNTOWN.lat, DOWNTOWN.lon, RADIUS_MI);
ok(dtCandidates.length >= 5, `downtown coordinate resolves >=5 signals within the radius (got ${dtCandidates.length})`);
ok(coverageWarningForCandidates(dtCandidates.length, RADIUS_MI) === undefined, "populated study returns no coverage warning");

// candidates come back nearest-first (engine relies on distance-sorted order)
const sorted = dtCandidates.every((c, i, a) => i === 0 || a[i - 1].distanceMi <= c.distanceMi);
ok(sorted, "candidates are returned sorted nearest-first");

// --- Helper is radius-aware in its message -------------------------------
const narrow = coverageWarningForCandidates(0, 0.25);
ok(narrow && /within 0\.25\s*mi/i.test(narrow.message), "message reflects a non-default radius (0.25 mi)");
ok(coverageWarningForCandidates(1, RADIUS_MI) === undefined, "a single found signal is enough to suppress the warning");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
