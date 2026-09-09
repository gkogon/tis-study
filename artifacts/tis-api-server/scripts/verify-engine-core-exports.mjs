// Guard for the lib/tis-engine-core package boundary.
//
// The package is the pure core of the TIS engine: every module in it must load
// under plain `node` (Node 26 type-stripping, no ts-loader hook, no bundler)
// and expose exactly the surface tis.ts, the routes, the renderers and the
// browser scenario solver import. Two contracts:
//
//   1. `import "@workspace/tis-engine-core"` resolves and evaluates under plain
//      node — which proves no module in the package imports the logger, the db,
//      fetch helpers or anything with a bare extensionless relative import.
//   2. The export list is exactly EXPECTED below. A missing name means a
//      consumer somewhere just broke; an extra name means something impure (or
//      simply undocumented) leaked into the core without this list being
//      updated deliberately.
//
// Standalone node script (no test runner). Run: `pnpm run check:engine-core-exports`
const m = await import("@workspace/tis-engine-core");

const EXPECTED = [
  // signal-delay
  "delayToLos", "vcToDelay", "queue95Ft",
  "CYCLE_LEN", "G_OVER_C", "SATURATION_FLOW_VPH", "CRITICAL_MOVEMENT_FRACTION",
  "PER_INTERSECTION_CAPACITY_VPH", "APPROACH_CAPACITY_VPH", "VEH_LENGTH_FT",
  "SCREENING_MAX_DELAY_SEC", "PLAUSIBLE_MAX_INTERSECTION_VC",
  // webster-timing
  "LOST_TIME_PER_PHASE_S", "MIN_CYCLE_S", "MAX_CYCLE_S", "ABSOLUTE_MAX_CYCLE_S", "ABSOLUTE_MIN_CYCLE_S",
  "MIN_PHASE_GREEN_S", "PED_WALK_S", "PED_WALK_SPEED_FTPS", "LANE_WIDTH_FT", "DEFAULT_THROUGH_LANES_PER_DIR",
  "MAX_CRITICAL_FLOW_RATIO", "LEFT_CROSS_PRODUCT_THRESHOLDS", "DEFAULT_LEFT_TURN_SHARE", "DEFAULT_THROUGH_SHARE",
  "pedestrianMinGreenS", "inferLeftPhasing", "computeSignalTiming", "timingFromSynchroPhases",
  "resolveSignalTiming", "gOverCForApproach", "gOverCForMovement", "criticalGOverC",
  // movement-assignment
  "assignMovementLoadsExact", "approachAddedTripsFromMovements", "assignMovements",
  "integerizeMovementLoads", "pathMovementLoadsExact",
  // trip-loading
  "LOAD_DECAY_MI", "intersectionLoadFraction",
  // land-uses
  "LAND_USES", "resolveRatesForVariable",
  // regional-growth-rates
  "getMeasuredGrowthSource", "getMeasuredGrowthRate", "GROWTH_OVERRIDE_PREFIX",
  "isGrowthOverride", "DESIGN_YEAR_HORIZON_DEFAULT",
  // utdf-import
  "UTDF_MOVEMENTS", "movementColumns", "parseUtdf", "approachVolumes",
  // volume-plausibility
  "implausibleVolumeDisclosures",
  // turbo-lane
  "TURBO_MAIN_STREET_GREEN_RATIO", "TURBO_GREEN_MIN", "TURBO_GREEN_MAX", "TURBO_GAIN_MIN", "TURBO_GAIN_MAX",
  "screenTurboCandidate", "deriveMainGreenRatio", "turboLaneScreening",
  // row-math
  "WEATHER_FACTOR", "PERIOD_VOLUME_FACTOR", "DIRECTIONS", "APPROACH_ORIGIN_BEARING",
  "bearingDeg", "hash32", "mulberry32", "approachVolumeShares", "approachAddedTripShares",
  "utdfApproachTotals", "utdfMeasuredTotals", "utdfGoverningStorage", "laneGroupsForApproach",
  "throughLanesByApproach", "resolveTimingForRow", "buildAffectedRow", "oppositeDir",
  "clamp", "round1", "round2", "round3",
  // mitigation
  "SCREENING_DELAY_DELTA_MINOR_SEC", "SCREENING_DELAY_DELTA_MODERATE_SEC",
  "verdictForHorizon", "recommendMitigation",
  // trips
  "periodRawTrips", "periodDirectionalIn", "externalTripsForPeriod",
];

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

const actual = Object.keys(m).sort();
const expected = [...new Set(EXPECTED)].sort();
const missing = expected.filter((k) => !actual.includes(k));
const extra = actual.filter((k) => !expected.includes(k));

ok(missing.length === 0, `every expected export is present${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
ok(extra.length === 0, `no undeclared export leaked into the core${extra.length ? ` (extra: ${extra.join(", ")})` : ""}`);
ok(actual.length === expected.length, `export count ${actual.length} matches the declared ${expected.length}`);

// Every runtime export is a function or a plain data constant — nothing async,
// nothing that could be a lazily-opened resource.
const kinds = new Set(actual.map((k) => typeof m[k]));
ok([...kinds].every((k) => k === "function" || k === "number" || k === "string" || k === "object"),
  `runtime exports are functions and plain data only (kinds: ${[...kinds].join(", ")})`);

// Spot-check the values that pin the screening basis, so a silent edit to a
// constant during a move shows up here as well as in the engine checks.
ok(m.PER_INTERSECTION_CAPACITY_VPH === 810, "PER_INTERSECTION_CAPACITY_VPH is 1800 x 0.45 = 810");
ok(m.WEATHER_FACTOR.clear === 1 && m.WEATHER_FACTOR.heavy_snow === 0.7, "WEATHER_FACTOR table intact (clear 1.0, heavy_snow 0.70)");
ok(m.PERIOD_VOLUME_FACTOR.am_peak === 0.9 && m.PERIOD_VOLUME_FACTOR.pm_peak === 1, "PERIOD_VOLUME_FACTOR anchors PM at 1.0, AM at 0.90");
ok(m.SCREENING_DELAY_DELTA_MINOR_SEC === 5 && m.SCREENING_DELAY_DELTA_MODERATE_SEC === 15, "screening mitigation thresholds are 5 s / 15 s");
ok(m.DESIGN_YEAR_HORIZON_DEFAULT === 20, "design-year horizon default is 20 years");
ok(Array.isArray(m.LAND_USES) && m.LAND_USES.length > 0, `land-use registry loads (${Array.isArray(m.LAND_USES) ? m.LAND_USES.length : 0} entries)`);
ok(m.DIRECTIONS.join(",") === "NB,SB,EB,WB", "DIRECTIONS order NB,SB,EB,WB (the approach-share RNG draws in this order)");

// The deterministic approach-share model is reproducible from the signal id
// alone — the property the browser solver relies on.
{
  const a = m.approachVolumeShares("signal-1");
  const b = m.approachVolumeShares("signal-1");
  const sum = m.DIRECTIONS.reduce((s, d) => s + a[d], 0);
  ok(JSON.stringify(a) === JSON.stringify(b) && Math.abs(sum - 1) < 1e-12,
    `approachVolumeShares is deterministic and sums to 1 (sum ${sum.toFixed(12)})`);
}

// buildAffectedRow runs on plain data with no server context at all.
{
  const row = m.buildAffectedRow(
    { sig: { id: "core-smoke", name: "Core & Smoke", zone: "z", latitude: 33.75, longitude: -84.39, totalVolume: 1200 }, distanceMi: 0.2 },
    0.5,
    { lat: 33.76, lon: -84.40 },
    {
      growthMultiplier: 1.03, designGrowthMultiplier: 1.35,
      capacityVph: 810, approachCapacityVph: 810,
      externalTrips: 120, inFraction: 0.6,
      periodVolumeFactor: 1, signalTiming: "computed", weatherFactor: 1,
    },
  );
  ok(row.signalId === "core-smoke" && row.approaches.length === 4 && typeof row.futureDelaySec === "number",
    `buildAffectedRow produces a row from plain data (LOS ${row.existingLos} -> ${row.futureLos}, ${row.approaches.length} approaches)`);
  ok(row.signalTiming?.basis === "webster", `signal timing resolved from volumes (basis ${row.signalTiming?.basis})`);
}

console.log(fails === 0 ? "\nAll engine-core export checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
