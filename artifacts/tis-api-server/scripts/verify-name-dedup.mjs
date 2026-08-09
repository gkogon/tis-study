/**
 * Regression guard for same-junction dedup (`dedupCloseSignals`).
 *
 * The name-based absorb used to fire at ANY distance: two signals sharing an
 * identical normalized name merged even hundreds of metres apart. OSM block
 * names ("Near Southwest 24th Street" repeats on 40+ nodes) and the auto
 * cross-street naming then collapsed physically DISTINCT junctions into one,
 * silently dropping intersections that should be studied. NAME_DEDUP_MAX_M now
 * bounds the name rule so it only fires for genuinely co-located same-name
 * signals, while true divided-arterial / big-junction node clusters (measured
 * up to ~148 m apart in Miami-Dade) still merge.
 *
 * Standalone node script (no test runner configured). Imports the pure leaf
 * module intersection-coverage.ts. Run: `pnpm run check:name-dedup`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const { dedupCloseSignals, sameSignalName, DEDUP_DISTANCE_M, NAME_DEDUP_MAX_M } = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// Build a distance-sorted candidate list from a study site — mirrors the engine
// (`intersectionsWithinRadius` sorts nearest-first before dedup runs).
const M_PER_MI = 1609.34;
const R_M = 6371000;
const havM = (aLat, aLon, bLat, bLon) => {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.sqrt(s));
};
const candidatesFrom = (site, sigs) =>
  sigs
    .map((sig) => ({ sig, distanceMi: havM(site.lat, site.lon, sig.latitude, sig.longitude) / M_PER_MI }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
// Offset a latitude by N metres (north/south only, so longitude scaling is moot).
const north = (lat, meters) => lat + meters / 111320;

// --- the ceilings are what we expect ---
ok(DEDUP_DISTANCE_M === 45, `DEDUP_DISTANCE_M is 45 (got ${DEDUP_DISTANCE_M})`);
ok(NAME_DEDUP_MAX_M === 150, `NAME_DEDUP_MAX_M is 150 (got ${NAME_DEDUP_MAX_M})`);
ok(NAME_DEDUP_MAX_M > DEDUP_DISTANCE_M, `name ceiling sits above the distance threshold`);

// --- name equality is street-pair-order-insensitive and empty-safe ---
ok(sameSignalName("A & B", "a  &  b") === true, `sameSignalName normalizes case + whitespace`);
ok(sameSignalName("A & B", "B & A") === true, `sameSignalName ignores street order ("A & B" = "B & A")`);
ok(sameSignalName("A & B", "A & C") === false, `different street pairs never match`);
ok(sameSignalName("Near A", "A & B") === false, `"Near X" block names don't match cross-street pairs`);
ok(sameSignalName("", "") === false && sameSignalName(null, null) === false, `empty/missing names never match`);

// --- 1. divided-arterial twins ~60 m apart, same name → MERGE (name rule, >45 m) ---
{
  const lat = 25.77, lon = -80.19;
  const sigs = [
    { id: "twin-s", name: "Test Blvd & Test Ave", latitude: lat, longitude: lon },
    { id: "twin-n", name: "Test Blvd & Test Ave", latitude: north(lat, 60), longitude: lon },
  ];
  const r = dedupCloseSignals(candidatesFrom({ lat, lon }, sigs));
  ok(r.kept.length === 1 && r.merged.length === 1, `divided-arterial twins ~60 m merge to 1 (kept ${r.kept.length})`);
  ok(r.nameAbsorbedBeyond45m === 1, `the ~60 m twin merge is counted as a name-absorb beyond 45 m`);
}

// --- 2. big-junction node cluster ~148 m apart, same name → MERGE (Federal/Pembroke case) ---
{
  const lat = 25.98, lon = -80.15;
  const sigs = [
    { id: "box-s", name: "Federal Highway & Pembroke Road", latitude: lat, longitude: lon },
    { id: "box-n", name: "Federal Highway & Pembroke Road", latitude: north(lat, 148), longitude: lon },
  ];
  const r = dedupCloseSignals(candidatesFrom({ lat, lon }, sigs));
  ok(r.kept.length === 1, `same-name big-junction nodes ~148 m (≤150) still merge (kept ${r.kept.length})`);
}

// --- 3. distinct junctions sharing a generic block name ~250 m apart → STAY SEPARATE (the fix) ---
{
  const lat = 25.76, lon = -80.22;
  const sigs = [
    { id: "blk-a", name: "Near Southwest 24th Street", latitude: lat, longitude: lon },
    { id: "blk-b", name: "Near Southwest 24th Street", latitude: north(lat, 250), longitude: lon },
  ];
  const r = dedupCloseSignals(candidatesFrom({ lat, lon }, sigs));
  ok(r.kept.length === 2 && r.merged.length === 0, `same block name ~250 m apart stays 2 distinct junctions (kept ${r.kept.length})`);
  ok(r.nameAbsorbedBeyond45m === 0, `no name-absorb fires beyond the ${NAME_DEDUP_MAX_M} m ceiling`);
}

// --- 4. co-located ≤45 m but DIFFERENT names → MERGE by distance (name-agnostic) ---
{
  const lat = 25.75, lon = -80.21;
  const sigs = [
    { id: "near-a", name: "Road A & Road B", latitude: lat, longitude: lon },
    { id: "near-b", name: "Ramp C Frontage", latitude: north(lat, 20), longitude: lon },
  ];
  const r = dedupCloseSignals(candidatesFrom({ lat, lon }, sigs));
  ok(r.kept.length === 1, `different-name signals 20 m apart merge on distance (kept ${r.kept.length})`);
  ok(r.nameAbsorbedBeyond45m === 0, `distance merges are not counted as name-absorbs`);
}

// --- 5. the real Miami-Dade case: SW 62nd Ave & S Dixie Hwy ---
// Two divided-arterial twins (~56 m) = ONE junction, plus a distinct junction
// ~200 m north that shares the auto-generated name. Old behavior dropped the
// distinct one; the fix keeps both. Study site sits on the main (south) junction.
{
  const trio = [
    { id: "3387", name: "Southwest 62nd Avenue & South Dixie Highway", latitude: 25.70107, longitude: -80.2933 },
    { id: "3388", name: "Southwest 62nd Avenue & South Dixie Highway", latitude: 25.70157, longitude: -80.29332 },
    { id: "4915", name: "Southwest 62nd Avenue & South Dixie Highway", latitude: 25.70287, longitude: -80.29336 },
  ];
  const site = { lat: 25.70120, lon: -80.29335 }; // parcel at the main junction
  const r = dedupCloseSignals(candidatesFrom(site, trio));
  const keptIds = new Set(r.kept.map((k) => k.sig.id));
  ok(r.kept.length === 2, `SW 62nd Ave & S Dixie Hwy: twins collapse, distinct junction survives → 2 kept (got ${r.kept.length})`);
  ok(keptIds.has("4915"), `the distinct ~200 m junction (4915) is preserved, not silently dropped`);
  ok(keptIds.has("3387") || keptIds.has("3388"), `the main junction (its nearest twin) is kept exactly once`);

  // Contrast: the OLD unbounded name rule (name match at any distance) collapsed
  // all three to a single junction. Reproduce it here to prove the regression.
  const oldDedup = (cands) => {
    const kept = [];
    for (const c of cands) {
      const dup = kept.some((k) => {
        const d = havM(c.sig.latitude, c.sig.longitude, k.sig.latitude, k.sig.longitude);
        return d <= DEDUP_DISTANCE_M || sameSignalName(c.sig.name, k.sig.name);
      });
      if (!dup) kept.push(c);
    }
    return kept;
  };
  ok(oldDedup(candidatesFrom(site, trio)).length === 1, `(old behavior collapsed all 3 to 1 — the bug this fixes)`);
}

// --- 6. the real Pasco County case: SR-54 & Little Rd (divided × divided box) ---
// OSM models this junction as FOUR signal nodes. The analyzer's cross-street
// naming orders each label by whichever road segment is closest to that node,
// so the box carries BOTH "Little Road & State Road 54" AND the flipped
// "State Road 54 & Little Road". One node sits 49 m from the nearest-kept node
// — beyond the 45 m distance rule — so with order-SENSITIVE name matching the
// study listed the same junction twice (identical LOS both rows). Real node
// coordinates + synthesized names from the Tampa inventory; site 28.2078,-82.6698.
{
  const box = [
    { id: "8611650344", name: "Little Road & State Road 54", latitude: 28.20631, longitude: -82.66623 },
    { id: "8611650345", name: "State Road 54 & Little Road", latitude: 28.20592, longitude: -82.66621 },
    { id: "8611650343", name: "State Road 54 & Little Road", latitude: 28.20609, longitude: -82.66579 },
    { id: "8611650346", name: "Little Road & State Road 54", latitude: 28.20568, longitude: -82.66603 },
  ];
  const site = { lat: 28.2078, lon: -82.6698 };
  const r = dedupCloseSignals(candidatesFrom(site, box));
  ok(r.kept.length === 1, `SR-54 & Little Rd: all 4 box nodes collapse to 1 junction (kept ${r.kept.length})`);
  ok(r.kept[0]?.sig.id === "8611650344", `the node nearest the site survives (kept ${r.kept[0]?.sig.id})`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
