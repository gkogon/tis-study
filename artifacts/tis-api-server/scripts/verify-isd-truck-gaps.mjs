/**
 * Accuracy guard: intersection-sight-distance (ISD) truck time gaps must match
 * the FREE public TxDOT Roadway Design Manual §13-5 (Tables 13-2 / 13-3), which
 * restates the standard Case-B ISD gap-time criteria. The published gaps are:
 *
 *                    passenger car   single-unit   combination
 *   Left  (T 13-2):      7.5 s         9.5 s         11.5 s     (+2.0 / +4.0)
 *   Right (T 13-3):      6.5 s         8.5 s         10.5 s     (+2.0 / +4.0)
 *   Crossing:            6.5 s         8.5 s         10.5 s     (+2.0 / +4.0)
 *
 * Two invariants this asserts, both previously violated (the engine UNDER-stated
 * truck ISD — a non-conservative, safety-relevant error):
 *   1. The truck adder is +2.0 s (single-unit) / +4.0 s (combination) over the
 *      passenger-car gap, and is UNIFORM across maneuver (the base gap already
 *      varies by maneuver, so the adder need NOT be per-maneuver).
 *   2. The per-additional-lane increment is 0.5 s for passenger cars but 0.7 s
 *      for trucks (TxDOT §13-5 multilane adjustment).
 *
 * No test runner is configured in this package, so this is a standalone node
 * script. Run with `pnpm run check:isd-truck-gaps` (Node >= 23, native TS).
 * Exits non-zero on the first failed invariant.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.resolve(here, "../src/lib/sight-distance.ts"));
const { runSightDistanceAnalysis } = mod;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

const SPEED = 45;
// ISD = 1.47 * V_major * t_gap, then Math.round to feet.
const expectFt = (gap) => Math.round(1.47 * SPEED * gap);

/** Run one ISD case and return the analysis. */
function run(maneuver, vehicleClass, lanesToCross = 0) {
  return runSightDistanceAnalysis({
    projectName: "isd-truck-gap-check",
    maneuver,
    vehicleClass,
    majorStreet: { name: "Major", designSpeedMph: SPEED },
    minorStreet: { name: "Minor", lanesToCross },
  });
}

// --- 1. Exact published gaps, no extra lanes (the heart of the fix) ---
const PUBLISHED = {
  left_from_minor: { passenger_car: 7.5, single_unit_truck: 9.5, combination_truck: 11.5 },
  right_from_minor: { passenger_car: 6.5, single_unit_truck: 8.5, combination_truck: 10.5 },
  crossing_from_minor: { passenger_car: 6.5, single_unit_truck: 8.5, combination_truck: 10.5 },
};
for (const [maneuver, byVeh] of Object.entries(PUBLISHED)) {
  for (const [veh, gap] of Object.entries(byVeh)) {
    const r = run(maneuver, veh);
    ok(close(r.isd.timeGapSec, gap), `${maneuver} / ${veh}: time gap is ${gap} s (got ${r.isd.timeGapSec})`);
    ok(r.isd.requiredFt === expectFt(gap), `${maneuver} / ${veh}: ISD required is ${expectFt(gap)} ft (got ${r.isd.requiredFt})`);
  }
}

// --- 2. Truck adder is +2.0 / +4.0 over passenger car, UNIFORM across maneuver ---
for (const maneuver of Object.keys(PUBLISHED)) {
  const pc = run(maneuver, "passenger_car").isd.timeGapSec;
  const su = run(maneuver, "single_unit_truck").isd.timeGapSec;
  const combo = run(maneuver, "combination_truck").isd.timeGapSec;
  ok(close(su - pc, 2.0), `${maneuver}: single-unit adder is +2.0 s (got +${(su - pc).toFixed(2)})`);
  ok(close(combo - pc, 4.0), `${maneuver}: combination adder is +4.0 s (got +${(combo - pc).toFixed(2)})`);
}

// --- 3. ISD required strictly INCREASES for heavier vehicles (the safety point) ---
for (const maneuver of Object.keys(PUBLISHED)) {
  const pc = run(maneuver, "passenger_car").isd.requiredFt;
  const su = run(maneuver, "single_unit_truck").isd.requiredFt;
  const combo = run(maneuver, "combination_truck").isd.requiredFt;
  ok(combo > su && su > pc, `${maneuver}: required ISD increases passenger(${pc}) < single-unit(${su}) < combination(${combo}) ft`);
}

// --- 4. Per-additional-lane increment: 0.5 s passenger car, 0.7 s trucks ---
const carLane0 = run("left_from_minor", "passenger_car", 0).isd.timeGapSec;
const carLane2 = run("left_from_minor", "passenger_car", 2).isd.timeGapSec;
ok(close((carLane2 - carLane0) / 2, 0.5), `passenger car: +0.5 s per additional lane (got +${((carLane2 - carLane0) / 2).toFixed(2)})`);

const comboLane0 = run("left_from_minor", "combination_truck", 0).isd.timeGapSec;
const comboLane2 = run("left_from_minor", "combination_truck", 2).isd.timeGapSec;
ok(close((comboLane2 - comboLane0) / 2, 0.7), `combination truck: +0.7 s per additional lane (got +${((comboLane2 - comboLane0) / 2).toFixed(2)})`);

const suLane3 = run("crossing_from_minor", "single_unit_truck", 3).isd.timeGapSec;
ok(close(suLane3, 6.5 + 2.0 + 3 * 0.7), `single-unit crossing, 3 lanes: gap is ${(6.5 + 2.0 + 3 * 0.7).toFixed(1)} s (got ${suLane3})`);

// --- 5. Regression: the old non-conservative adders (+1.0 / +1.5) are gone ---
ok(run("left_from_minor", "combination_truck").isd.timeGapSec !== 9.0,
  "combination left turn no longer uses the old +1.5 s adder (was 9.0 s)");
ok(run("left_from_minor", "single_unit_truck").isd.timeGapSec !== 8.5,
  "single-unit left turn no longer uses the old +1.0 s adder (was 8.5 s)");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
