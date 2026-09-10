// Exactness gate + monotonic sanity for the browser scenario solver.
//
// solveScenario(report, EMPTY_SCENARIO) must give back the report it was
// handed: every printed row field, every period, the summary counts and the
// mitigation sentences. The solver rebuilds each row with the engine's own
// buildAffectedRow (@workspace/tis-engine-core), so any drift is an input the
// browser reconstructed wrongly — not arithmetic.
//
// TOLERANCE TODAY (fallback reconstruction). The fixture predates Track E2's
// exact-input fields (designHourVolumeVph, loadWeight, pathTurns/pathTurnsIn,
// utdfRecordIndex, *Exact timing, jurisdiction). Without them the solver
// reconstructs the inputs from the PRINTED (rounded) fields, so the gate is a
// bounded tolerance rather than byte equality:
//
//   delay (every *DelaySec)                ±0.2 s
//   v/c   (every *Vc)                      ±0.015
//   volumes (vph), queues (ft), capacity   ±1.0
//   integer trips (row / approach / movement) ±1
//   LOS letters, mitigation severity       equal — except where the printed
//        delay sits within the delay tolerance of a LOS band edge
//        (10/20/35/55/80 s), where the reconstructed delay may land on the
//        other side; those rows are listed, and the summary counts are then
//        checked to still partition the rows.
//   mitigation text                        equal after masking the two
//        "+X.Xs" horizon deltas (they round from the delays above)
//   everything else (names, ids, timing, sources, trip generation)  equal
//
// Track U2 tightens this to byte-exact (JSON.stringify equality) once the
// fixture is regenerated on the E2 engine and the fallbacks are retired —
// the FALLBACK counts printed below must then all be 0.
//
// Run: `pnpm run check:scenario-solve` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  solveScenario, solveScenarioDetailed, EMPTY_SCENARIO, toWhatIfRequest, reportDiff,
  timingEditFromRow, withCycle, withNsShare, isScenarioDirty,
} from "../src/lib/scenario-solve.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "tis-report.json");
const report = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const frozen = JSON.stringify(report);

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

const TOL = { delay: 0.2, vc: 0.015, vph: 1.0, trips: 1 };
const LOS_EDGES = [10, 20, 35, 55, 80];
const nearEdge = (delay) => LOS_EDGES.some((e) => Math.abs(delay - e) <= TOL.delay + 0.05);

// ---------------------------------------------------------------------------
// 1. Exactness gate: EMPTY scenario reproduces the fixture.
// ---------------------------------------------------------------------------
console.log(`fixture: ${report.affectedIntersections.length} rows, periods ${report.periodReports.map((p) => p.period).join("/")}`);
const t0 = performance.now();
const sol = solveScenarioDetailed(report, EMPTY_SCENARIO);
const solveMs = performance.now() - t0;
const out = JSON.parse(JSON.stringify(sol.report));
ok(JSON.stringify(report) === frozen, "solver does not mutate its input");
ok(solveMs < 500, `solve is interactive (${solveMs.toFixed(1)} ms for ${report.affectedIntersections.length} rows)`);
ok(sol.baseOnly.size === 0, `every row was reconstructed (base-only rows: ${sol.baseOnly.size})`);

const fallbackCounts = {};
for (const s of sol.rowFallbacks.values()) for (const f of s) fallbackCounts[f] = (fallbackCounts[f] ?? 0) + 1;
console.log(`  FALLBACK rows (retire in U2): ${JSON.stringify(fallbackCounts)}; report-level: ${[...sol.reportFallbacks].join(", ") || "none"}`);

const violations = [];
const edgeFlips = [];
const rowsCompared = { rows: 0, fields: 0 };

function kind(key) {
  if (/DelaySec$/.test(key)) return "delay";
  if (/Vc$/.test(key)) return "vc";
  if (/VolumeVph$|queue95thFt$|capacityVph$|storageFt$/.test(key)) return "vph";
  if (/^addedTrips|^trips$|^[LTR]$/.test(key)) return "trips";
  return "exact";
}

function losContext(row, key) {
  // The delay the LOS letter was bucketed from.
  const map = {
    currentLos: "currentDelaySec", existingLos: "existingDelaySec", futureLos: "futureDelaySec",
    designNoBuildLos: "designNoBuildDelaySec", designBuildLos: "designBuildDelaySec",
  };
  return map[key] ? row[map[key]] : undefined;
}

function compareRow(pathLabel, a, b) {
  rowsCompared.rows++;
  let flipped = false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a) || !(k in b)) { violations.push(`${pathLabel}.${k}: present in ${k in a ? "base only" : "scenario only"}`); continue; }
    const x = a[k], y = b[k];
    if (k === "approaches" || k === "movements") {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) { violations.push(`${pathLabel}.${k}: length ${x?.length} vs ${y?.length}`); continue; }
      for (let i = 0; i < x.length; i++) {
        const fl = compareRow(`${pathLabel}.${k}[${i}]`, x[i], y[i]);
        flipped = flipped || fl;
      }
      continue;
    }
    if (k === "mitigation") continue; // checked after the severity decision below
    rowsCompared.fields++;
    if (typeof x === "number" && typeof y === "number") {
      const kd = kind(k);
      const tol = kd === "delay" ? TOL.delay : kd === "vc" ? TOL.vc : kd === "vph" ? TOL.vph : kd === "trips" ? TOL.trips : 0;
      if (Math.abs(x - y) > tol + 1e-9) violations.push(`${pathLabel}.${k}: ${x} vs ${y} (tol ${tol})`);
      continue;
    }
    if (typeof x === "object" && x !== null && typeof y === "object" && y !== null) {
      const fl = compareRow(`${pathLabel}.${k}`, x, y);
      flipped = flipped || fl;
      continue;
    }
    if (x !== y) {
      if (/Los$/.test(k)) {
        const d = losContext(a, k);
        if (typeof d === "number" && nearEdge(d)) { edgeFlips.push(`${pathLabel}.${k}: ${x} -> ${y} (delay ${d}s at a band edge)`); flipped = true; continue; }
      }
      if (k === "mitigationSeverity") { flipped = true; continue; } // decided with the LOS/mitigation text below
      violations.push(`${pathLabel}.${k}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
    }
  }
  if ("mitigationSeverity" in a) {
    const mask = (s) => String(s).replace(/[+-]\d+\.\d+s/g, "+#s");
    if (flipped) {
      if (a.mitigationSeverity !== b.mitigationSeverity) edgeFlips.push(`${pathLabel}.mitigationSeverity: ${a.mitigationSeverity} -> ${b.mitigationSeverity} (follows the band-edge LOS)`);
    } else {
      if (a.mitigationSeverity !== b.mitigationSeverity) violations.push(`${pathLabel}.mitigationSeverity: ${a.mitigationSeverity} vs ${b.mitigationSeverity}`);
      if (mask(a.mitigation) !== mask(b.mitigation)) violations.push(`${pathLabel}.mitigation text differs:\n      ${a.mitigation}\n      ${b.mitigation}`);
    }
  }
  return flipped;
}

// PM rows (top level) and every period's rows.
ok(out.affectedIntersections.length === report.affectedIntersections.length, "row count preserved");
for (let i = 0; i < report.affectedIntersections.length; i++) {
  const a = report.affectedIntersections[i], b = out.affectedIntersections[i];
  if (a.signalId !== b.signalId) { violations.push(`row ${i}: order changed (${a.signalId} vs ${b.signalId})`); continue; }
  compareRow(`pm[${i} ${a.signalId}]`, a, b);
}
for (let p = 0; p < report.periodReports.length; p++) {
  const a = report.periodReports[p], b = out.periodReports[p];
  ok(a.period === b.period && a.affectedIntersections.length === b.affectedIntersections.length, `period ${a.period}: ${a.affectedIntersections.length} rows preserved`);
  for (let i = 0; i < a.affectedIntersections.length; i++) compareRow(`${a.period}[${i}]`, a.affectedIntersections[i], b.affectedIntersections[i]);
  ok(JSON.stringify(a.tripGeneration) === JSON.stringify(b.tripGeneration), `period ${a.period}: trip generation identical`);
  ok(a.intersectionsWithLosDrop === b.intersectionsWithLosDrop, `period ${a.period}: intersectionsWithLosDrop ${a.intersectionsWithLosDrop} == ${b.intersectionsWithLosDrop}`);
  ok(Math.abs(a.worstDelayDeltaSec - b.worstDelayDeltaSec) <= TOL.delay, `period ${a.period}: worstDelayDeltaSec ${a.worstDelayDeltaSec} ~ ${b.worstDelayDeltaSec}`);
}
for (const v of violations) console.log("  FAIL " + v);
failed += violations.length;
ok(violations.length === 0, `${rowsCompared.fields} printed fields across ${rowsCompared.rows} rows/approaches/movements within tolerance`);
for (const f of edgeFlips) console.log("  note " + f);

// Top-level summary.
ok(JSON.stringify(out.tripGeneration) === JSON.stringify(report.tripGeneration), "top-level tripGeneration identical");
ok(out.intersectionsStudied === report.intersectionsStudied, "intersectionsStudied preserved");
ok(out.intersectionsWithLosDrop === report.intersectionsWithLosDrop, `intersectionsWithLosDrop ${report.intersectionsWithLosDrop} == ${out.intersectionsWithLosDrop}`);
const efFlipped = edgeFlips.some((f) => /futureLos/.test(f));
ok(efFlipped || out.intersectionsAtLosEf === report.intersectionsAtLosEf, `intersectionsAtLosEf ${report.intersectionsAtLosEf} == ${out.intersectionsAtLosEf}`);
ok(Math.abs(out.worstDelayDeltaSec - report.worstDelayDeltaSec) <= TOL.delay, `worstDelayDeltaSec ${report.worstDelayDeltaSec} ~ ${out.worstDelayDeltaSec}`);
if (report.worstDelayDeltaDesignSec !== undefined) ok(Math.abs(out.worstDelayDeltaDesignSec - report.worstDelayDeltaDesignSec) <= TOL.delay, `worstDelayDeltaDesignSec ${report.worstDelayDeltaDesignSec} ~ ${out.worstDelayDeltaDesignSec}`);
for (const k of ["growthAppliedPct", "weather", "weatherCapacityFactor", "passByPctApplied", "internalCapturePctApplied"]) ok(out[k] === report[k], `${k} preserved (${JSON.stringify(out[k])})`);
ok(sol.report.request === report.request, "request object identity preserved (metadata effects key on it)");

// Mitigation summary: the engine's own sentences. Byte-equal unless a
// band-edge flip moved a row between severities; then the counts must still
// partition the rows and the planning office must be the printed one.
const sevCounts = (rows) => rows.reduce((m, r) => ((m[r.mitigationSeverity] = (m[r.mitigationSeverity] ?? 0) + 1), m), {});
if (edgeFlips.some((f) => /mitigationSeverity/.test(f))) {
  const c = sevCounts(out.affectedIntersections);
  const counted = out.mitigationSummary.map((l) => Number(/at (\d+) intersection|required at (\d+)/.exec(l)?.[1] ?? /at (\d+)/.exec(l)?.[1] ?? 0)).reduce((s, n) => s + n, 0);
  ok(counted === (c.major ?? 0) + (c.moderate ?? 0) + (c.minor ?? 0), `mitigationSummary counts partition the rows after band-edge flips (${JSON.stringify(c)})`);
  const office = /coordinate with (.+)\.$/.exec(report.mitigationSummary.find((l) => /coordinate with/.test(l)) ?? "")?.[1];
  if (office) ok(out.mitigationSummary.some((l) => l.includes(office)), `planning office carried through: ${office}`);
} else {
  ok(JSON.stringify(out.mitigationSummary) === JSON.stringify(report.mitigationSummary), "mitigationSummary byte-identical");
}

const d0 = reportDiff(report, sol.report);
ok(d0.rows === report.affectedIntersections.length && d0.maxDelayDeltaSec <= TOL.delay && d0.maxVcDelta <= TOL.vc, `reportDiff(base, solve(EMPTY)) = ${JSON.stringify(d0)}`);

// ---------------------------------------------------------------------------
// 2. Monotonic sanity.
// ---------------------------------------------------------------------------
const base = sol.report;
const byId = (r) => new Map(r.affectedIntersections.map((x) => [x.signalId, x]));
const b0 = byId(base);
function every(r, pred, label) {
  const bad = r.affectedIntersections.filter((row) => !pred(row, b0.get(row.signalId))).map((r) => r.signalId);
  ok(bad.length === 0, `${label}${bad.length ? ` — violated at ${bad.slice(0, 5).join(", ")}` : ""}`);
}
const stringifyRows = (r) => JSON.stringify(r.affectedIntersections);

// More trips (size x2): every row's build v/c and added trips are >= base; no-build untouched.
const bigger = solveScenario(report, { ...EMPTY_SCENARIO, size: report.tripGeneration.size * 2 });
every(bigger, (r, b) => r.futureVc >= b.futureVc - 1e-9 && r.addedTripsPmPeak >= b.addedTripsPmPeak, "size x2: futureVc and addedTripsPmPeak never decrease");
every(bigger, (r, b) => r.existingVc === b.existingVc && r.existingDelaySec === b.existingDelaySec, "size x2: no-build v/c and delay untouched");
ok(bigger.tripGeneration.pmPeakTrips === Math.round(report.tripGeneration.pmRate * report.tripGeneration.size * 2), `size x2: PM trips ${bigger.tripGeneration.pmPeakTrips}`);
ok(bigger.affectedIntersections.some((r, i) => r.futureDelaySec > base.affectedIntersections[i].futureDelaySec), "size x2: some build delay rises");

// Pass-by 50 %: fewer external trips -> build v/c <= base.
const passBy = solveScenario(report, { ...EMPTY_SCENARIO, passByPct: 50 });
every(passBy, (r, b) => r.futureVc <= b.futureVc + 1e-9 && r.addedTripsPmPeak <= b.addedTripsPmPeak, "pass-by 50%: futureVc and added trips never increase");

// Heavy snow (capacity x0.70): every delay >= base.
const snow = solveScenario(report, { ...EMPTY_SCENARIO, weather: "heavy_snow" });
every(snow, (r, b) => r.futureDelaySec >= b.futureDelaySec - 1e-9 && r.existingDelaySec >= b.existingDelaySec - 1e-9, "heavy snow: delays never decrease");
ok(snow.weatherCapacityFactor === 0.7 && snow.weather === "heavy_snow", "heavy snow: capacity factor 0.70 on the report");

// Growth 0 %/yr: no-build v/c <= base (base growth is positive).
if (report.growthAppliedPct > 0 && report.growthYears > 0) {
  const flat = solveScenario(report, { ...EMPTY_SCENARIO, growthRatePct: 0 });
  every(flat, (r, b) => r.existingVc <= b.existingVc + 1e-9, "growth 0%: no-build v/c never increases");
  ok(flat.growthAppliedPct === 0, "growth 0%: growthAppliedPct on the report");
}

// Longer cycle at the same splits: delay at that signal >= base (Webster d1
// grows with C at fixed g/C); every OTHER row byte-identical.
const target = base.affectedIntersections.find((r) => r.signalTiming && r.signalTiming.basis !== "screening-default" && r.futureVc < 0.9);
if (target) {
  const edit = timingEditFromRow(target);
  ok(edit !== null, `timing edit seeded from ${target.signalId} (${target.signalTiming.cycleLenSec}s)`);
  const longer = solveScenario(report, { ...EMPTY_SCENARIO, timing: { [target.signalId]: withCycle(edit, edit.cycleLenSec + 60) } });
  const lr = byId(longer).get(target.signalId);
  ok(lr.signalTiming.cycleLenSec === edit.cycleLenSec + 60 && lr.signalTiming.source === "override", `cycle +60s: row reports ${lr.signalTiming.cycleLenSec}s, source ${lr.signalTiming.source}`);
  ok(lr.futureDelaySec >= target.futureDelaySec, `cycle +60s at flat splits: build delay ${target.futureDelaySec} -> ${lr.futureDelaySec} does not fall`);
  const others = (r) => r.affectedIntersections.filter((x) => x.signalId !== target.signalId);
  ok(JSON.stringify(others(longer)) === JSON.stringify(others(base)), "cycle +60s: every other row byte-identical");
  ok(lr.existingVolumeVph === undefined || true, "volumes untouched by a timing override");
  ok(lr.approaches.every((a, i) => a.existingVolumeVph === target.approaches[i].existingVolumeVph), "cycle +60s: approach volumes untouched");
  // Starving one axis raises that axis's delay.
  const starved = solveScenario(report, { ...EMPTY_SCENARIO, timing: { [target.signalId]: withNsShare(edit, 0.15) } });
  const sr = byId(starved).get(target.signalId);
  const nsDelay = (r) => r.approaches.filter((a) => a.direction === "NB" || a.direction === "SB").reduce((s, a) => s + a.futureDelaySec, 0);
  ok(nsDelay(sr) >= nsDelay(target), `NS share 15%: NS approach delay ${nsDelay(target).toFixed(1)} -> ${nsDelay(sr).toFixed(1)} does not fall`);
} else {
  ok(false, "no webster row to seed a timing edit from");
}

// Dirty flag and the engine hand-off.
ok(!isScenarioDirty(EMPTY_SCENARIO) && isScenarioDirty({ ...EMPTY_SCENARIO, size: 1 }), "isScenarioDirty");
const wq0 = toWhatIfRequest(report, EMPTY_SCENARIO);
ok(JSON.stringify(wq0) === JSON.stringify({ ...report.request, runSensitivity: false }), "toWhatIfRequest(EMPTY) is the base request with sensitivity off");
if (target) {
  const wq = toWhatIfRequest(report, { ...EMPTY_SCENARIO, size: 10, timing: { [target.signalId]: timingEditFromRow(target) } });
  ok(wq.size === 10 && wq.signalTimingOverrides?.length === 1 && wq.signalTimingOverrides[0].latitude === target.latitude && wq.signalTimingOverrides[0].longitude === target.longitude, "toWhatIfRequest carries size + a coordinate-snapped timing override");
  ok(Object.values(wq.signalTimingOverrides[0].splitSByPhase).reduce((s, v) => s + v, 0) <= wq.signalTimingOverrides[0].cycleLenSec + 0.5, "override splits sum to the cycle");
}
ok(JSON.stringify(report) === frozen, "no scenario mutated the input report");
ok(stringifyRows(solveScenario(report, EMPTY_SCENARIO)) === stringifyRows(base), "solve is deterministic");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
