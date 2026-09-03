/**
 * Regression guard: the study set must account for every in-radius signal.
 *
 * The engine used to report `intersectionsInStudyArea` as the POST-dedup count,
 * so a study that had silently lost intersections looked complete. Measured on
 * tacoma_metro (site 47.1900,-122.4600, r=1.0 mi): the inventory holds 17
 * signals inside the radius, the engine returned 13, and both counts printed as
 * 13. The four absorbed records sat 104-129 m from the signal that absorbed
 * them -- beyond DEDUP_DISTANCE_M, inside NAME_DEDUP_MAX_M, merged on name
 * equality alone.
 *
 * Why name equality is weak evidence there: tacoma-signals.json carries `name`
 * null on all 1,351 records, so every name is derived by the analyzer from the
 * two nearest named roads. That label describes proximity, not junction
 * identity -- a signal 111 m east of Hosmer on S 72nd derives the same
 * "South 72nd Street & South Hosmer Street" as the one at the crossing.
 *
 * This guard does NOT assert the merges are wrong; distinguishing a
 * divided-arterial box (measured to ~148 m in Miami-Dade) from two distinct
 * junctions needs the analyzer's naming tier, which this layer cannot see.
 * It asserts the accounting is honest: whatever the dedup removes is COUNTED
 * and REPORTED, so the loss can never again be invisible.
 *
 * Standalone node script (no test runner configured). Run:
 *   pnpm run check:signal-set-reconciliation
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const { dedupCloseSignals, DEDUP_DISTANCE_M, NAME_DEDUP_MAX_M } = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

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

// --- 1. the accounting invariant: nothing vanishes unaccounted ---
// Real tacoma_metro geometry and the analyzer-derived names for those nodes.
{
  const site = { lat: 47.19, lon: -122.46 };
  const N = (n) => n; // readability
  const sigs = [
    { id: "tacoma-251", name: N("South 72nd Street & South Hosmer Street"), latitude: 47.19128, longitude: -122.46123 },
    { id: "tacoma-625", name: N("South 72nd Street & South Hosmer Street"), latitude: 47.19187, longitude: -122.45976 },
    { id: "tacoma-385", name: N("South 74th Street & Tacoma Mall Boulevard"), latitude: 47.19012, longitude: -122.46440 },
    { id: "tacoma-799", name: N("Tacoma Mall Boulevard & South 74th Street"), latitude: 47.18910, longitude: -122.46428 },
    { id: "tacoma-822", name: N("Tacoma Mall Boulevard & South 74th Street"), latitude: 47.18897, longitude: -122.46426 },
    { id: "tacoma-728", name: N("South 72nd Street & South Yakima Avenue"), latitude: 47.19190, longitude: -122.44326 },
    { id: "tacoma-727", name: N("South 72nd Street & South Yakima Avenue"), latitude: 47.19190, longitude: -122.44189 },
  ];
  const inRadius = sigs.length;
  const r = dedupCloseSignals(candidatesFrom(site, sigs));
  ok(
    r.kept.length + r.merged.length === inRadius,
    `every in-radius record is either kept or counted as merged (${r.kept.length} + ${r.merged.length} = ${inRadius})`,
  );
  ok(r.merged.length === 4, `the four Tacoma corridor signals are absorbed by the name rule (merged ${r.merged.length})`);
  ok(
    r.nameAbsorbedBeyond45m === r.merged.length,
    `every absorb here fired on NAME beyond ${DEDUP_DISTANCE_M} m, not co-location ` +
      `(nameAbsorbedBeyond45m ${r.nameAbsorbedBeyond45m} of ${r.merged.length})`,
  );
  const gaps = [
    havM(47.19128, -122.46123, 47.19187, -122.45976), // 251 <- 625
    havM(47.19012, -122.46440, 47.18910, -122.46428), // 385 <- 799
    havM(47.19012, -122.46440, 47.18897, -122.46426), // 385 <- 822
    havM(47.19190, -122.44326, 47.19190, -122.44189), // 728 <- 727
  ];
  ok(
    gaps.every((g) => g > DEDUP_DISTANCE_M && g <= NAME_DEDUP_MAX_M),
    `each absorbed pair sits in the name-rule band ${DEDUP_DISTANCE_M}-${NAME_DEDUP_MAX_M} m ` +
      `(${gaps.map((g) => Math.round(g)).join(", ")} m)`,
  );
}

// --- 2. the counts must survive the response schema (the #183 strip) ---
{
  const spec = fs.readFileSync(path.resolve(here, "../../../lib/tis-api-spec/openapi.yaml"), "utf8");
  for (const f of ["intersectionsInStudyArea", "intersectionsMergedAsDuplicates"]) {
    ok(spec.includes(`${f}:`), `${f} is declared in openapi.yaml (else zod strips it from every response)`);
  }
  const zodPath = path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts");
  if (fs.existsSync(zodPath)) {
    const zod = fs.readFileSync(zodPath, "utf8");
    for (const f of ["intersectionsInStudyArea", "intersectionsMergedAsDuplicates"]) {
      ok(zod.includes(f), `${f} reached the generated zod schema (re-run codegen if this fails)`);
    }
  } else {
    console.log("SKIP  generated zod not built in this checkout");
  }
}

console.log(fails === 0 ? "\nsignal-set reconciliation OK" : `\n${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
