// Regression check: an intersection's control delay, v/c and LOS must be
// built from the approach rows printed beneath it.
//
// Why this exists: Datum proofread passes on the regenerated hosted samples
// (2026-10-01) found worksheets whose intersection result contradicted every
// approach on the same page. Allegheny A.16, Perry Highway & Highland Avenue,
// printed the intersection at "LOS F · 109.4 s/veh · v/c 1.15" above four
// approaches at LOS C, 24.2–25.4 s, v/c 0.62–0.68. A control delay averaged
// over the vehicles entering an intersection cannot exceed the delay of every
// approach those vehicles enter on.
//
// The cause was a second, independent model in buildAffectedRow: the
// intersection row took 45% of total entering volume as its critical demand
// and set it against ONE phase's capacity (saturation flow x the larger
// through-phase g/C), while each approach set its own volume against its own
// phase. Under computed (Webster) timing a protected-left phase shrinks the
// through g/C and widens the gap; it was present under flat timing too.
//
// Under test, for real rows rebuilt from their printed inputs
// (fixtures/intersection-delay-rows.json) and for synthetic rows under both
// timing modes:
//   1. Intersection delay, in every scenario, lies within the delays of the
//      approaches that carry traffic, and equals their volume-weighted mean.
//   2. The intersection LOS letter is the letter for the intersection delay.
//   3. The intersection v/c does not exceed its worst approach v/c.
//   4. The design-year scenarios aggregate the same way as the opening year:
//      with the design growth equal to the opening growth, they match exactly.
//   5. An oversaturated row stays within the reporting cap.
//   6. A background volume above the plausibility ceiling at an approach is
//      still disclosed (Broward, N University Dr & Green Tree Ln).
//
// Run: node ./scripts/verify-intersection-delay.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const core = await import(path.resolve(here, "../../../lib/tis-engine-core/src/index.ts"));
const fx = JSON.parse(readFileSync(path.resolve(here, "fixtures/intersection-delay-rows.json"), "utf8"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const SCENARIOS = [
  { key: "current", label: "current year" },
  { key: "existing", label: "no-build" },
  { key: "future", label: "build" },
];

function buildCase(c, overrides = {}) {
  const params = {
    capacityVph: core.PER_INTERSECTION_CAPACITY_VPH * c.params.weatherFactor,
    approachCapacityVph: core.APPROACH_CAPACITY_VPH * c.params.weatherFactor,
    ...c.params,
    ...overrides,
  };
  return core.buildAffectedRow(
    { sig: c.sig, distanceMi: c.distanceMi, ...(c.legEstimate ? { legEstimate: c.legEstimate } : {}) },
    c.loadWeight, c.site, params, undefined, c.pathTurns, c.pathTurnsIn,
  );
}

function checkAgainstApproaches(label, row) {
  for (const { key, label: scen } of SCENARIOS) {
    const loaded = row.approaches.filter((a) => a[`${key}VolumeVph`] > 0);
    if (loaded.length === 0) { ok(false, `${label} ${scen}: no approach carries traffic`); continue; }
    const delays = loaded.map((a) => a[`${key}DelaySec`]);
    const lo = Math.min(...delays), hi = Math.max(...delays);
    const d = row[`${key}DelaySec`];
    ok(d >= lo - 0.1 && d <= hi + 0.1,
      `${label} ${scen}: intersection delay ${d} s lies within its approaches' ${lo}–${hi} s`);
    const vol = loaded.reduce((t, a) => t + a[`${key}VolumeVph`], 0);
    const mean = loaded.reduce((t, a) => t + a[`${key}VolumeVph`] * a[`${key}DelaySec`], 0) / vol;
    ok(Math.abs(d - mean) <= 0.15,
      `${label} ${scen}: intersection delay ${d} s is the volume-weighted mean of its approaches (${mean.toFixed(2)} s)`);
    ok(row[`${key}Los`] === core.delayToLos(d),
      `${label} ${scen}: LOS ${row[`${key}Los`]} is the letter for ${d} s`);
    const worstVc = Math.max(...loaded.map((a) => a[`${key}Vc`]));
    ok(row[`${key}Vc`] <= worstVc + 0.01,
      `${label} ${scen}: intersection v/c ${row[`${key}Vc`]} does not exceed its worst approach (${worstVc})`);
  }
}

// --- 1-3. Real rows, rebuilt from their printed inputs ---------------------
for (const c of fx.cases) checkAgainstApproaches(c.label, buildCase(c));

// --- 1-3. Synthetic rows, both timing modes, light and heavy demand --------
const SYN_SITE = { lat: 40.5, lon: -80.0 };
const synSig = (id, totalVolume) => ({ id, name: `Synthetic ${id}`, zone: "TEST", latitude: 40.505, longitude: -80.004, totalVolume });
const synParams = (signalTiming) => ({
  growthMultiplier: 1.03, designGrowthMultiplier: 1.35,
  capacityVph: core.PER_INTERSECTION_CAPACITY_VPH, approachCapacityVph: core.APPROACH_CAPACITY_VPH,
  externalTrips: 400, inFraction: 0.5, periodVolumeFactor: 1, signalTiming, weatherFactor: 1,
});
const synthetic = [];
for (const timing of ["screening", "computed"]) {
  for (const [id, vol] of [["light", 1400], ["heavy", 3200], ["over", 7000]]) {
    const row = core.buildAffectedRow({ sig: synSig(`${timing}-${id}`, vol), distanceMi: 0.3 }, 0.25, SYN_SITE, synParams(timing));
    synthetic.push({ timing, id, row });
    checkAgainstApproaches(`synthetic ${timing} ${id} (${vol} vph)`, row);
  }
}

// --- 4. Design year aggregates the same way as the opening year ------------
for (const c of fx.cases.slice(0, 1)) {
  const same = buildCase(c, { designGrowthMultiplier: c.params.growthMultiplier });
  ok(same.designNoBuildDelaySec === same.existingDelaySec && same.designBuildDelaySec === same.futureDelaySec
      && same.designNoBuildVc === same.existingVc && same.designBuildVc === same.futureVc
      && same.designNoBuildLos === same.existingLos && same.designBuildLos === same.futureLos,
    `${c.label}: with design growth = opening growth, design no-build/build equal no-build/build `
      + `(${same.designNoBuildDelaySec}/${same.designBuildDelaySec} s vs ${same.existingDelaySec}/${same.futureDelaySec} s)`);
}
for (const { timing, id, row } of synthetic) {
  ok(row.designBuildDelaySec >= row.futureDelaySec - 0.1,
    `synthetic ${timing} ${id}: design-year build (${row.designBuildDelaySec} s) is not below the opening-year build (${row.futureDelaySec} s)`);
}

// --- 5. Cap -----------------------------------------------------------------
for (const { timing, id, row } of synthetic) {
  const all = ["current", "existing", "future", "designNoBuild", "designBuild"].map((k) => row[`${k}DelaySec`]);
  ok(all.every((d) => d <= core.SCREENING_MAX_DELAY_SEC),
    `synthetic ${timing} ${id}: every intersection delay is within the ${core.SCREENING_MAX_DELAY_SEC} s cap (${all.join(", ")})`);
}

// --- 6. An implausible background volume at an approach is still disclosed --
{
  const c = fx.cases.find((x) => x.sig.name === "North University Drive & Green Tree Lane");
  const row = buildCase(c);
  const worstBackground = Math.max(...row.approaches.map((a) => Math.max(a.currentVc, a.existingVc)));
  const lines = core.implausibleVolumeDisclosures([row]);
  ok(worstBackground > core.PLAUSIBLE_MAX_INTERSECTION_VC && lines.length === 1 && lines[0].includes(c.sig.name),
    `${c.label}: background approach v/c ${worstBackground} > ${core.PLAUSIBLE_MAX_INTERSECTION_VC} is disclosed (${lines.length} disclosure line)`);
}

if (fails) {
  console.error(`\n${fails} check(s) FAILED`);
  process.exit(1);
}
console.log("\nall intersection-delay checks passed");
