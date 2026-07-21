/**
 * Regression guard for the additive force-include of study intersections
 * (`forceIncludeIntersections`) and the engine union it feeds.
 *
 * The gap this closes (reported by Caltran Engineering, Miami-Dade): a TIS
 * corridor scope is an agreed LIST of study intersections following an arterial
 * — e.g. NW 7 Ave @ NW 79/81/103 St, spanning ~1.5 mi — which fall OUTSIDE a
 * default 0.5-mi study radius and were silently dropped. The signals are in the
 * inventory, so this is a scoping-INPUT gap: the request can now force-include
 * specific signals (by id) or coordinates (snapped to the nearest signal),
 * UNIONed with the radius set and never removing anything the radius found.
 *
 * These checks assert (1) the pure resolver: id match / unknown-id reporting,
 * coordinate snap within/beyond SNAP_MAX_MI, id+point de-dup, distance measured
 * from the SITE, empty-in ⇒ empty-out; and (2) the exact union the engine runs
 * in findAffectedIntersections — beyond-radius forced signals get appended,
 * an OSM way-split of a kept junction collapses, and an already-in-radius forced
 * signal is flagged (so it survives the opt-in scope trim) without duplicating.
 *
 * Standalone node script (no test runner configured). Imports the pure leaf
 * module intersection-coverage.ts. Run: `pnpm run check:force-include`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const {
  forceIncludeIntersections,
  intersectionsWithinRadius,
  dedupCloseSignals,
  SNAP_MAX_MI,
  DEDUP_DISTANCE_M,
} = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- Synthetic Miami-style arterial corridor, all signals due north of site ----
// The corridor mirrors Caltran's real scope: two signals inside a 0.5-mi radius
// plus three further up the arterial that a radius search would miss.
const DEG_PER_MI_LAT = 1 / 69.0;
const site = { lat: 25.83, lon: -80.21 };
const northMi = (mi) => site.lat + mi * DEG_PER_MI_LAT;
const sig = (id, mi, name = null, lonOffset = 0) => ({
  id,
  name,
  latitude: northMi(mi),
  longitude: site.lon + lonOffset,
});

const A = sig("A", 0.20, "NW 7 Ave & NW 54 St");   // in radius
const B = sig("B", 0.45, "NW 7 Ave & NW 62 St");   // in radius
const C = sig("C", 0.90, "NW 7 Ave & NW 79 St");   // beyond 0.5 mi
const D = sig("D", 1.20, "NW 7 Ave & NW 81 St");   // beyond 0.5 mi
const E = sig("E", 1.50, "NW 7 Ave & NW 103 St");  // beyond 0.5 mi
// F: OSM way-split of D — same junction, ~30 m east (0.0003° lon ≈ 30 m at 25.8°N).
const F = { id: "F", name: "NW 7 Ave & NW 81 St", latitude: northMi(1.20), longitude: site.lon + 0.0003 };
const inventory = [A, B, C, D, E, F];

// ---- (1) Pure resolver -------------------------------------------------------

// 1a. Exact id match, unknown id surfaced, distance from the SITE, nearest-first.
{
  const r = forceIncludeIntersections(inventory, site.lat, site.lon, { ids: ["C", "E", "ZZZ"] });
  const ids = r.included.map((e) => e.sig.id);
  ok(ids.length === 2 && ids[0] === "C" && ids[1] === "E", `ids ["C","E","ZZZ"] resolve to [C,E] nearest-first (got [${ids}])`);
  ok(JSON.stringify(r.unmatchedIds) === JSON.stringify(["ZZZ"]), `unknown id "ZZZ" reported as unmatched`);
  const dC = r.included.find((e) => e.sig.id === "C").distanceMi;
  ok(near(dC, 0.90, 0.05), `distanceMi is measured from the SITE (C ≈ 0.90 mi, got ${dC.toFixed(3)})`);
  ok(dC > 0.5, `forced signal C sits BEYOND the 0.5-mi radius (the whole point)`);
}

// 1b. Coordinate snaps to the nearest signal within SNAP_MAX_MI; far point ignored.
{
  const nearC = { latitude: northMi(0.95), longitude: site.lon };  // 0.05 mi from C
  const ocean = { latitude: 26.5, longitude: -79.0 };              // no signal within 0.35 mi
  const r = forceIncludeIntersections(inventory, site.lat, site.lon, { points: [nearC, ocean] });
  const ids = r.included.map((e) => e.sig.id);
  ok(ids.length === 1 && ids[0] === "C", `point 0.05 mi from C snaps to C (got [${ids}])`);
  ok(r.unsnappedPoints.length === 1, `ocean point (> SNAP_MAX_MI=${SNAP_MAX_MI} from any signal) is left unsnapped`);
}

// 1c. An id and a point resolving to the SAME signal de-dup to one entry.
{
  const nearC = { latitude: northMi(0.92), longitude: site.lon };
  const r = forceIncludeIntersections(inventory, site.lat, site.lon, { ids: ["C"], points: [nearC] });
  ok(r.included.length === 1 && r.included[0].sig.id === "C", `id "C" + a point near C yield ONE entry, not two`);
}

// 1d. A point just past the snap ceiling does not snap.
{
  // ~0.5 mi east of B — beyond SNAP_MAX_MI from every corridor signal.
  const off = { latitude: northMi(0.45), longitude: site.lon + 0.5 * DEG_PER_MI_LAT / Math.cos((site.lat * Math.PI) / 180) };
  const r = forceIncludeIntersections(inventory, site.lat, site.lon, { points: [off] });
  ok(r.included.length === 0 && r.unsnappedPoints.length === 1, `point ~0.5 mi from any signal (> ${SNAP_MAX_MI}) does not snap`);
}

// 1e. Empty / absent input ⇒ empty result (the no-op that keeps radius behavior byte-identical).
{
  const r = forceIncludeIntersections(inventory, site.lat, site.lon, {});
  ok(r.included.length === 0 && r.unmatchedIds.length === 0 && r.unsnappedPoints.length === 0, `empty force-include input ⇒ empty result`);
}

// ---- (2) Engine union — mirrors findAffectedIntersections's block ------------

// Replicate the engine's compose so the union + dedup + forced-flag semantics
// are guarded without a live analyzer.
function engineFind(inv, lat, lon, radiusMi, forceInclude) {
  const kept = dedupCloseSignals(intersectionsWithinRadius(inv, lat, lon, radiusMi)).kept;
  const has = forceInclude && ((forceInclude.ids?.length ?? 0) > 0 || (forceInclude.points?.length ?? 0) > 0);
  if (!has) return kept;
  const { included } = forceIncludeIntersections(inv, lat, lon, forceInclude);
  const forcedIds = new Set(included.map((e) => e.sig.id));
  for (const k of kept) if (forcedIds.has(k.sig.id)) k.forced = true;
  const keptIds = new Set(kept.map((k) => k.sig.id));
  const extras = included
    .filter((e) => !keptIds.has(e.sig.id))
    .map((e) => ({ sig: e.sig, distanceMi: e.distanceMi, forced: true }));
  if (extras.length === 0) return kept;
  return dedupCloseSignals([...kept, ...extras].sort((a, b) => a.distanceMi - b.distanceMi)).kept;
}

// 2a. Baseline: radius 0.5 mi finds only A and B; corridor C/D/E are dropped.
{
  const r = engineFind(inventory, site.lat, site.lon, 0.5, undefined);
  const ids = r.map((c) => c.sig.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(["A", "B"]), `0.5-mi radius alone finds [A,B], drops the corridor (got [${ids}])`);
}

// 2b. Byte-identical no-op: empty force-include changes nothing vs. baseline.
{
  const base = engineFind(inventory, site.lat, site.lon, 0.5, undefined).map((c) => c.sig.id);
  const withEmpty = engineFind(inventory, site.lat, site.lon, 0.5, { ids: [], points: [] }).map((c) => c.sig.id);
  ok(JSON.stringify(base) === JSON.stringify(withEmpty), `empty force-include is a no-op (radius output unchanged)`);
}

// 2c. Force-include the beyond-radius corridor by id: C/D/E join A/B and are flagged.
{
  const r = engineFind(inventory, site.lat, site.lon, 0.5, { ids: ["C", "D", "E"] });
  const ids = r.map((c) => c.sig.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(["A", "B", "C", "D", "E"]), `forced corridor is UNIONed with the radius set (got [${ids}])`);
  const forced = r.filter((c) => c.forced).map((c) => c.sig.id).sort();
  ok(JSON.stringify(forced) === JSON.stringify(["C", "D", "E"]), `only the beyond-radius additions are flagged forced (got [${forced}])`);
  const aForced = r.find((c) => c.sig.id === "A").forced;
  ok(!aForced, `in-radius signals stay unflagged when not force-requested`);
}

// 2d. An OSM way-split of a forced junction collapses (no double-count).
{
  const r = engineFind(inventory, site.lat, site.lon, 0.5, { ids: ["D", "F"] });
  const ids = r.map((c) => c.sig.id).sort();
  ok(!ids.includes("F"), `F (≤${DEDUP_DISTANCE_M} m from D — same physical junction) is absorbed, not double-counted`);
  ok(ids.includes("D"), `the surviving record for that junction (D) is kept`);
}

// 2e. Force-including an ALREADY-in-radius signal flags it (survives scope trim) w/o duplicating.
{
  const r = engineFind(inventory, site.lat, site.lon, 0.5, { ids: ["A"] });
  const ids = r.map((c) => c.sig.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(["A", "B"]), `forcing in-radius A adds no row (got [${ids}])`);
  ok(r.find((c) => c.sig.id === "A").forced === true, `in-radius A is flagged forced so the opt-in scope trim can't drop it`);
}

// 2f. Coordinate-driven scope (names unknown/null) still works — the robust path.
{
  const pts = [
    { latitude: northMi(0.90), longitude: site.lon },   // → C
    { latitude: northMi(1.50), longitude: site.lon },   // → E
  ];
  const r = engineFind(inventory, site.lat, site.lon, 0.5, { points: pts });
  const ids = r.map((c) => c.sig.id).sort();
  ok(JSON.stringify(ids) === JSON.stringify(["A", "B", "C", "E"]), `pasted/clicked coordinates snap + union the corridor (got [${ids}])`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
