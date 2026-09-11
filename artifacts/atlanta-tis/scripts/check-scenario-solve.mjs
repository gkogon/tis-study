// Exactness gate, engine parity, and sanity for the browser scenario solver.
//
// Both fixtures are REAL output of THIS branch's engine (generateTisReport
// against the live analyzer — see scripts/fixtures/README.md):
//
//   A  scenario-base.json       the Peachtree Multifamily request, verbatim.
//   B  scenario-overrides.json  the same request + two signalTimingOverrides
//                               (one longer cycle, one protected NS left)
//                               + size x1.5.
//
// 1. EXACTNESS.  solveScenario(A, EMPTY_SCENARIO) must give back A: every
//    printed field of every row, approach and movement, every period, the
//    summary counts and the mitigation sentences — byte-equal after a JSON
//    round-trip, with NO tolerance. The solver rebuilds each row with the
//    engine's own buildAffectedRow, so any drift at all is an input the
//    browser reconstructed wrongly. `rowFallbacks` must be EMPTY: an E2
//    report carries every exact input, so no reconstruction path may fire.
//
// 2. PARITY.  solveScenario(A, <the scenario B was generated from>) must equal
//    B the same way. The scenario state is rebuilt here from A alone and
//    `toWhatIfRequest` is asserted to reproduce B's request byte-for-byte, so
//    the two sides are provably the same what-if.
//
//    ONE DOCUMENTED EXCEPTION, and it is architectural, not arithmetic. A trip
//    -magnitude change makes the ENGINE re-run the network assignment, whose
//    BPR congestion feedback moves `tripDistribution.byDirection` (~1e-5
//    relative between A and B). The browser has no road network, so it holds
//    the distribution and the path ledgers at the base study's values — the
//    "distribution held at base" the UI discloses. That carries into exactly
//    three printed re-solve INPUTS: `loadWeight`, the `share` of each
//    `pathTurns` / `pathTurnsIn` entry, and the `exact` of each
//    `movementsExact` entry. They are checked to NETWORK_TOL relative and the
//    check asserts they are the ONLY fields that differ — every printed
//    RESULT (delay, v/c, LOS, volumes, queues, timing, trips, mitigation) is
//    byte-equal. Closing this would mean shipping the road network to the
//    browser or approximating the feedback; the studio sends the scenario to
//    the engine instead.
//
// Run: `pnpm run check:scenario-solve` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  solveScenario, solveScenarioDetailed, EMPTY_SCENARIO, toWhatIfRequest, reportDiff,
  timingEditFromRow, withCycle, withNsShare, withProtectedLeft, isScenarioDirty,
} from "../src/lib/scenario-solve.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", n), "utf8"));
const A = load("scenario-base.json");
const B = load("scenario-overrides.json");
const frozenA = JSON.stringify(A);

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

// The three network-assignment carry-overs (see header). Everything else is
// compared with NO tolerance.
const NETWORK_FIELDS = new Set(["loadWeight", "share", "exact"]);
const NETWORK_TOL = 1e-3; // relative; observed drift is ~8e-5

/** Deep compare after a JSON round-trip. Returns a list of `path: a vs b`.
 *  `allowNetwork` permits ONLY the three carry-over fields to differ, and only
 *  within NETWORK_TOL — every other field must be identical. */
function diffDeep(expected, actual, { allowNetwork = false } = {}) {
  const out = [];
  const seenNetwork = new Map();
  const walk = (p, key, x, y) => {
    if (x === y) return;
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) { out.push(`${p}: array ${x?.length} vs ${y?.length}`); return; }
      for (let i = 0; i < x.length; i++) walk(`${p}[${i}]`, key, x[i], y[i]);
      return;
    }
    if (x && y && typeof x === "object" && typeof y === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (!(k in x) || !(k in y)) { out.push(`${p}.${k}: present in ${k in x ? "expected" : "actual"} only`); continue; }
        walk(`${p}.${k}`, k, x[k], y[k]);
      }
      return;
    }
    if (allowNetwork && NETWORK_FIELDS.has(key) && typeof x === "number" && typeof y === "number") {
      const rel = Math.abs(x - y) / Math.max(1e-12, Math.abs(x));
      seenNetwork.set(key, Math.max(seenNetwork.get(key) ?? 0, rel));
      if (rel > NETWORK_TOL) out.push(`${p}: ${x} vs ${y} (rel ${rel.toExponential(2)} over ${NETWORK_TOL})`);
      return;
    }
    out.push(`${p}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  };
  walk("$", "$", expected, actual);
  return { out, network: seenNetwork };
}

/** Every printed row surface: the top-level PM rows and every period's rows. */
function rowSurfaces(report) {
  return [
    ["pm", report.affectedIntersections],
    ...report.periodReports.map((p) => [p.period, p.affectedIntersections]),
  ];
}

function compareRows(expected, actual, label, opts) {
  let fields = 0, network = new Map();
  for (const [name, rows] of rowSurfaces(expected)) {
    const got = name === "pm" ? actual.affectedIntersections : actual.periodReports.find((p) => p.period === name)?.affectedIntersections;
    if (!got || got.length !== rows.length) { ok(false, `${label}: ${name} row count ${rows.length} vs ${got?.length}`); continue; }
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].signalId !== got[i].signalId) { ok(false, `${label}: ${name}[${i}] order changed`); continue; }
      const { out, network: n } = diffDeep(rows[i], got[i], opts);
      for (const [k, v] of n) network.set(k, Math.max(network.get(k) ?? 0, v));
      fields += Object.keys(rows[i]).length;
      for (const v of out.slice(0, 4)) { failed++; console.log(`  FAIL ${label} ${name}[${i} ${rows[i].signalId}]${v.slice(1)}`); }
      if (out.length > 4) { console.log(`  ... and ${out.length - 4} more on this row`); failed += out.length - 4; }
    }
  }
  return { fields, network };
}

// ---------------------------------------------------------------------------
// 1. Exactness: EMPTY scenario reproduces fixture A byte-for-byte.
// ---------------------------------------------------------------------------
console.log(`\nfixture A: ${A.affectedIntersections.length} rows, periods ${A.periodReports.map((p) => p.period).join("/")}`);
const t0 = performance.now();
const solA = solveScenarioDetailed(A, EMPTY_SCENARIO);
const solveMs = performance.now() - t0;

ok(JSON.stringify(A) === frozenA, "solver does not mutate its input");
ok(solveMs < 500, `solve is interactive (${solveMs.toFixed(1)} ms for ${A.affectedIntersections.length} rows)`);
ok(solA.baseOnly.size === 0, `every row reconstructed (base-only: ${solA.baseOnly.size})`);
ok(solA.rowFallbacks.size === 0, `NO row fallback fired — the E2 report carries every exact input (${solA.rowFallbacks.size} rows flagged)`);
ok(solA.reportFallbacks.size === 0, `NO report-level fallback fired (${[...solA.reportFallbacks].join(", ") || "none"})`);

const outA = JSON.parse(JSON.stringify(solA.report));
const cmpA = compareRows(A, outA, "exactness", {});
ok(true, `compared ${cmpA.fields} row fields across ${A.periodReports.length + 1} surfaces with NO tolerance`);

for (const p of A.periodReports) {
  const q = outA.periodReports.find((z) => z.period === p.period);
  ok(JSON.stringify(p.tripGeneration) === JSON.stringify(q.tripGeneration), `period ${p.period}: tripGeneration byte-identical`);
  ok(p.intersectionsWithLosDrop === q.intersectionsWithLosDrop && p.intersectionsAtLosEf === q.intersectionsAtLosEf
    && p.worstDelayDeltaSec === q.worstDelayDeltaSec, `period ${p.period}: summary counts byte-identical`);
}
ok(JSON.stringify(outA.tripGeneration) === JSON.stringify(A.tripGeneration), "top-level tripGeneration byte-identical");
ok(JSON.stringify(outA.mitigationSummary) === JSON.stringify(A.mitigationSummary), "mitigationSummary byte-identical");
for (const k of ["intersectionsStudied", "intersectionsWithLosDrop", "intersectionsAtLosEf", "worstDelayDeltaSec",
  "worstDelayDeltaDesignSec", "growthAppliedPct", "weather", "weatherCapacityFactor", "passByPctApplied", "internalCapturePctApplied"]) {
  ok(JSON.stringify(outA[k]) === JSON.stringify(A[k]), `${k} byte-identical (${JSON.stringify(A[k])})`);
}
ok(solA.report.request === A.request, "request object identity preserved (metadata effects key on it)");
const d0 = reportDiff(A, solA.report);
ok(d0.rows === A.affectedIntersections.length && d0.maxDelayDeltaSec === 0 && d0.maxVcDelta === 0 && d0.losMismatches === 0,
  `reportDiff(A, solve(A, EMPTY)) = ${JSON.stringify(d0)} — 0 differences`);

// ---------------------------------------------------------------------------
// 2. Parity with the engine: fixture B's scenario, re-derived from A alone.
// ---------------------------------------------------------------------------
console.log(`\nfixture B: size ${B.request.size}, ${B.request.signalTimingOverrides.length} timing overrides`);
const cands = A.affectedIntersections.filter((r) => r.signalTiming && r.signalTiming.basis !== "screening-default");
ok(cands.length >= 2, `${cands.length} rows carry a resolved timing plan to override`);
const [rowLongCycle, rowProtLeft] = cands;
const editA = timingEditFromRow(rowLongCycle), editB = timingEditFromRow(rowProtLeft);
const scenarioB = {
  ...EMPTY_SCENARIO,
  size: A.tripGeneration.size * 1.5,
  timing: {
    [rowLongCycle.signalId]: withCycle(editA, Math.min(300, editA.cycleLenSec + 60)),
    [rowProtLeft.signalId]: withProtectedLeft(editB, "ns", true),
  },
};
// The state and the fixture describe the SAME what-if — proven, not assumed.
ok(JSON.stringify(toWhatIfRequest(A, scenarioB)) === JSON.stringify(B.request),
  "toWhatIfRequest(A, scenario) reproduces fixture B's request byte-for-byte");

const solB = solveScenarioDetailed(A, scenarioB);
ok(solB.rowFallbacks.size === 0 && solB.baseOnly.size === 0, "scenario solve fires no fallback either");
ok(solB.distributionHeld, "solve discloses that the distribution is held at base (trips changed)");

const outB = JSON.parse(JSON.stringify(solB.report));
const cmpB = compareRows(B, outB, "parity", { allowNetwork: true });
const netSeen = [...cmpB.network].map(([k, v]) => `${k} <= ${v.toExponential(1)}`).join(", ");
ok(true, `compared ${cmpB.fields} row fields against the engine; only the network carry-overs moved (${netSeen || "none"})`);
ok(cmpB.network.size <= NETWORK_FIELDS.size, "no field outside loadWeight / share / exact needed a tolerance");
for (const p of B.periodReports) {
  const q = outB.periodReports.find((z) => z.period === p.period);
  ok(JSON.stringify(p.tripGeneration) === JSON.stringify(q.tripGeneration), `period ${p.period}: scenario tripGeneration byte-identical to the engine`);
  ok(p.intersectionsWithLosDrop === q.intersectionsWithLosDrop && p.intersectionsAtLosEf === q.intersectionsAtLosEf
    && p.worstDelayDeltaSec === q.worstDelayDeltaSec, `period ${p.period}: scenario summary counts byte-identical to the engine`);
}
ok(JSON.stringify(outB.mitigationSummary) === JSON.stringify(B.mitigationSummary), "scenario mitigationSummary byte-identical to the engine");
ok(JSON.stringify(outB.tripGeneration) === JSON.stringify(B.tripGeneration), "scenario top-level tripGeneration byte-identical to the engine");
for (const k of ["intersectionsWithLosDrop", "intersectionsAtLosEf", "worstDelayDeltaSec", "worstDelayDeltaDesignSec"]) {
  ok(JSON.stringify(outB[k]) === JSON.stringify(B[k]), `scenario ${k} byte-identical to the engine (${JSON.stringify(B[k])})`);
}
const dB = reportDiff(B, solB.report);
ok(dB.maxDelayDeltaSec === 0 && dB.maxVcDelta === 0 && dB.losMismatches === 0,
  `reportDiff(engine B, client solve) = ${JSON.stringify(dB)} — 0 differences (this is the studio's "engine vs client" line)`);

// The two overridden rows really did take the override, and nothing else did.
const bById = new Map(B.affectedIntersections.map((r) => [r.signalId, r]));
const sById = new Map(solB.report.affectedIntersections.map((r) => [r.signalId, r]));
for (const id of [rowLongCycle.signalId, rowProtLeft.signalId]) {
  ok(sById.get(id).signalTiming.source === "override" && bById.get(id).signalTiming.source === "override",
    `${id}: both engine and client stamp signalTiming.source "override"`);
}
ok(solB.report.affectedIntersections.filter((r) => r.signalTiming?.source === "override").length === 2,
  "exactly the two overridden rows carry source \"override\"");

// ---------------------------------------------------------------------------
// 3. Monotonic sanity, override isolation, determinism, immutability.
// ---------------------------------------------------------------------------
console.log("");
const base = solA.report;
const b0 = new Map(base.affectedIntersections.map((x) => [x.signalId, x]));
const every = (r, pred, label) => {
  const bad = r.affectedIntersections.filter((row) => !pred(row, b0.get(row.signalId))).map((x) => x.signalId);
  ok(bad.length === 0, `${label}${bad.length ? ` — violated at ${bad.slice(0, 5).join(", ")}` : ""}`);
};

const bigger = solveScenario(A, { ...EMPTY_SCENARIO, size: A.tripGeneration.size * 2 });
every(bigger, (r, b) => r.futureVc >= b.futureVc - 1e-9 && r.addedTripsPmPeak >= b.addedTripsPmPeak, "size x2: futureVc and addedTripsPmPeak never decrease");
every(bigger, (r, b) => r.existingVc === b.existingVc && r.existingDelaySec === b.existingDelaySec, "size x2: no-build v/c and delay untouched");
ok(bigger.tripGeneration.pmPeakTrips === Math.round(A.tripGeneration.pmRate * A.tripGeneration.size * 2), `size x2: PM trips ${bigger.tripGeneration.pmPeakTrips}`);
ok(bigger.affectedIntersections.some((r, i) => r.futureDelaySec > base.affectedIntersections[i].futureDelaySec), "size x2: some build delay rises");

const passBy = solveScenario(A, { ...EMPTY_SCENARIO, passByPct: 50 });
every(passBy, (r, b) => r.futureVc <= b.futureVc + 1e-9 && r.addedTripsPmPeak <= b.addedTripsPmPeak, "pass-by 50%: futureVc and added trips never increase");

const snow = solveScenario(A, { ...EMPTY_SCENARIO, weather: "heavy_snow" });
every(snow, (r, b) => r.futureDelaySec >= b.futureDelaySec - 1e-9 && r.existingDelaySec >= b.existingDelaySec - 1e-9, "heavy snow: delays never decrease");
ok(snow.weatherCapacityFactor === 0.7 && snow.weather === "heavy_snow", "heavy snow: capacity factor 0.70 on the report");

if (A.growthAppliedPct > 0 && A.growthYears > 0) {
  const flat = solveScenario(A, { ...EMPTY_SCENARIO, growthRatePct: 0 });
  every(flat, (r, b) => r.existingVc <= b.existingVc + 1e-9, "growth 0%: no-build v/c never increases");
  ok(flat.growthAppliedPct === 0, "growth 0%: growthAppliedPct on the report");
}

// Longer cycle at the same splits: delay at that signal >= base; every OTHER
// row byte-identical (override isolation).
const target = base.affectedIntersections.find((r) => r.signalTiming && r.signalTiming.basis !== "screening-default" && r.futureVc < 0.9);
if (target) {
  const edit = timingEditFromRow(target);
  ok(edit !== null, `timing edit seeded from ${target.signalId} (${target.signalTiming.cycleLenSec}s)`);
  const longer = solveScenario(A, { ...EMPTY_SCENARIO, timing: { [target.signalId]: withCycle(edit, edit.cycleLenSec + 60) } });
  const lr = longer.affectedIntersections.find((r) => r.signalId === target.signalId);
  ok(lr.signalTiming.cycleLenSec === edit.cycleLenSec + 60 && lr.signalTiming.source === "override", `cycle +60s: row reports ${lr.signalTiming.cycleLenSec}s, source ${lr.signalTiming.source}`);
  ok(lr.futureDelaySec >= target.futureDelaySec, `cycle +60s at flat splits: build delay ${target.futureDelaySec} -> ${lr.futureDelaySec} does not fall`);
  const others = (r) => r.affectedIntersections.filter((x) => x.signalId !== target.signalId);
  ok(JSON.stringify(others(longer)) === JSON.stringify(others(base)), "cycle +60s: every other row byte-identical (override isolation)");
  ok(lr.approaches.every((a, i) => a.existingVolumeVph === target.approaches[i].existingVolumeVph), "cycle +60s: approach volumes untouched by a timing override");
  const starved = solveScenario(A, { ...EMPTY_SCENARIO, timing: { [target.signalId]: withNsShare(edit, 0.15) } });
  const sr = starved.affectedIntersections.find((r) => r.signalId === target.signalId);
  const nsDelay = (r) => r.approaches.filter((a) => a.direction === "NB" || a.direction === "SB").reduce((s, a) => s + a.futureDelaySec, 0);
  ok(nsDelay(sr) >= nsDelay(target), `NS share 15%: NS approach delay ${nsDelay(target).toFixed(1)} -> ${nsDelay(sr).toFixed(1)} does not fall`);
} else {
  ok(false, "no webster row to seed a timing edit from");
}

ok(!isScenarioDirty(EMPTY_SCENARIO) && isScenarioDirty({ ...EMPTY_SCENARIO, size: 1 }), "isScenarioDirty");
ok(JSON.stringify(toWhatIfRequest(A, EMPTY_SCENARIO)) === JSON.stringify({ ...A.request, runSensitivity: false }),
  "toWhatIfRequest(EMPTY) is the base request with sensitivity off");
ok(JSON.stringify(A) === frozenA, "no scenario mutated the input report");
ok(JSON.stringify(solveScenario(A, EMPTY_SCENARIO).affectedIntersections) === JSON.stringify(base.affectedIntersections), "solve is deterministic");
ok(JSON.stringify(solveScenario(A, scenarioB).affectedIntersections) === JSON.stringify(solB.report.affectedIntersections), "scenario solve is deterministic");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
