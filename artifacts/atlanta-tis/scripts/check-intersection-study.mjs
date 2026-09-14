// Headless pass over the intersection study's section model
// (src/lib/intersection-study-model.ts) for EVERY studied row of the real
// fixtures (scripts/fixtures/README.md — engine output, nothing hand-typed):
//
//   A  scenario-base.json       40 rows, no import attached
//   B  scenario-overrides.json  the same study with two timing overrides and
//                               size × 1.5 — the scenario row for each base row
//
// For every row, base alone AND paired with its scenario row:
//   1. every section has its inputs — a summary, a plan with the row's
//      approaches, one queuing model per approach, a timing model with the
//      Webster comparison, sim inputs for BOTH scenarios, a what-if seed, and
//      a mitigation model with method notes;
//   2. no NaN / Infinity anywhere in the model (deep walk);
//   3. queue / storage flags are exactly the plan's (intersection-geometry):
//      storageFt, storageDeficient and the pass/fail/not_measured verdict
//      agree with planFromRow on every approach;
//   4. the §02 capacity is the engine's: vph ÷ (1800 × g/C × lanes × weather)
//      reproduces the printed build v/c within rounding, and queue95Ft on the
//      same capacity reproduces the printed Q95 within rounding, so the lane
//      animation discharges at the rate the report's numbers were computed
//      against;
//   5. sim inputs build for every row in both scenarios, on the drawn row's
//      timing (a paired scenario row's override drives the sim: the
//      protected-NS override row's build inputs carry a protected-left phase
//      and a left bay);
//   6. the §05 controls seed from signalTiming EXACTLY: the model's edit deep-
//      equals timingEditFromRow(drawn row) — what the studio's Signal tab
//      seeds from — on every row, and cycle / splits are the printed plan's
//      (g/C × C + 5 s lost time);
//   7. the Webster comparison reproduces the printed plan on every row whose
//      basis is "webster" (websterInUse true) and never claims to on a
//      screening-default or override row; with an import (lane groups + an
//      imported cycle, synthesized) it passes the measured left share and the
//      measured cycle exactly as row-math.ts hands the fallback, and the
//      result is the engine's "measured-cycle" plan.
//   9. weather ≠ 1: every row of a heavy-snow scenario (solveScenario, factor
//      0.70) paired with its base — the §02 capacity at the SCENARIO's factor
//      reproduces the scenario row's printed v/c and Q95 on all 160
//      approaches, the sim inputs discharge at 1800 × 0.70, and the same
//      model at the base's factor 1 does NOT reproduce them (the M3 bug);
//      scenarioWeatherFactor answers the factor for both cases.
//  10. two through lanes (synthesized on the designated row): the §02
//      capacity doubles, the lane animation's marks are the per-lane share
//      (Q95 ÷ 2, Q1 ÷ 2, λ ÷ 2), the engine readout keeps the approach
//      total, the sim inputs carry 2 lanes.
//  11. like-for-like labels: the end-of-red mean λ(C − g) per lane relates to
//      the recomputed Q95 by exactly the engine's 1/(1 − x·g/C) and 1.65 on
//      every approach; a calibrated row's engine readout divides the
//      multiplier back out (clamped as row-math.ts clamps it); a row with an
//      imported cycle and no plan sizes §02 on that cycle; a scenario row
//      identical to its base (an edit on ANOTHER signal) is not a scenario;
//      the storage flag compares the queue the plan names; the honesty
//      sentence and the sim caption carry their conditions.
//
// Run: `pnpm run check:intersection-study` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  studyModelFromRow, SECTIONS, Q95_FACTOR, websterForRow, scenarioRowDiffers, calibrationMultiplierOf,
  ENGINE_RECOMPUTATIONS, SIM_AGREEMENT_CONDITIONS,
} from "../src/lib/intersection-study-model.ts";
import { planFromRow, DIRECTIONS, QUEUE_FT_PER_VEH } from "../src/lib/intersection-geometry.ts";
import { timingEditFromRow, LOST_TIME_S, MIN_SPLIT_S, solveScenario, scenarioWeatherFactor, EMPTY_SCENARIO } from "../src/lib/scenario-solve.ts";
import { IntersectionSim } from "../src/lib/intersection-sim.ts";
import { SATURATION_FLOW_VPH, queue95Ft, computeSignalTiming } from "@workspace/tis-engine-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", n), "utf8"));
const A = load("scenario-base.json");
const B = load("scenario-overrides.json");

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

function walkFinite(v, trail, bad, seen = new Set()) {
  if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(trail); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walkFinite(x, `${trail}[${i}]`, bad, seen)); return; }
  if (v && typeof v === "object") {
    if (seen.has(v)) return;
    seen.add(v);
    for (const [k, x] of Object.entries(v)) walkFinite(x, `${trail}.${k}`, bad, seen);
  }
}
const nonFinite = (m) => { const bad = []; walkFinite(m, "model", bad); return bad; };
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const weatherFactor = A.weatherFactorExact ?? A.weatherCapacityFactor ?? 1;
const byIdB = new Map(B.affectedIntersections.map((r) => [r.signalId, r]));
console.log(`fixtures: A ${A.affectedIntersections.length} rows, B ${B.affectedIntersections.length} rows, weather factor ${weatherFactor}`);
ok(SECTIONS.length === 8 && SECTIONS.map((s) => s.n).join() === "00,01,01a,02,03,04,05,06", "eight sections §00–§06 in order, §01a Distribution between §01 and §02 (its model is check:intersection-distribution's)");

// ---------------------------------------------------------------------------
console.log("\n1–3. every row, base and paired: sections present, finite, flags the plan's");
{
  let rows = 0, apps = 0, bad = [];
  const cases = [];
  for (const r of A.affectedIntersections) {
    cases.push({ label: `${r.signalId} base`, row: r, scen: null });
    const s = byIdB.get(r.signalId);
    if (s) cases.push({ label: `${r.signalId} paired`, row: r, scen: s });
  }
  for (const c of cases) {
    rows++;
    const m = studyModelFromRow(c.row, c.scen, { weatherFactor });
    const drawn = c.scen ?? c.row;
    const plan = planFromRow(c.row, c.scen);
    const nf = nonFinite(m);
    if (nf.length) bad.push(`${c.label}: non-finite at ${nf.slice(0, 3).join(", ")}`);
    if (m.signalId !== drawn.signalId || m.name !== drawn.name) bad.push(`${c.label}: identity`);
    if (m.scenario !== !!c.scen) bad.push(`${c.label}: scenario flag`);
    // §00
    if (!m.summary || m.summary.los.build !== drawn.futureLos || m.summary.delay.build !== drawn.futureDelaySec || m.summary.worstQueueFt !== drawn.queue95thFt || typeof m.summary.timingBasis !== "string" || !m.summary.timingBasis) bad.push(`${c.label}: summary`);
    if (c.scen && (!m.summary.base || m.summary.base.delay.build !== c.row.futureDelaySec)) bad.push(`${c.label}: summary base pair`);
    // §01
    if (m.plan.approaches.length !== drawn.approaches.length || m.plan.approaches.length !== plan.approaches.length) bad.push(`${c.label}: plan approaches`);
    // §02 — one per approach, flags exactly the plan's
    if (m.queuing.length !== plan.approaches.length) bad.push(`${c.label}: queuing count`);
    for (const q of m.queuing) {
      apps++;
      const a = plan.approaches.find((x) => x.direction === q.direction);
      if (!a) { bad.push(`${c.label} ${q.direction}: no plan approach`); continue; }
      if ((a.storageFt ?? null) !== q.storageFt) bad.push(`${c.label} ${q.direction}: storageFt`);
      if ((a.storageFt !== undefined ? !!a.storageDeficient : null) !== q.storageDeficient) bad.push(`${c.label} ${q.direction}: storageDeficient`);
      const expectV = q.storageFt === null ? "not_measured" : q.storageDeficient ? "fail" : "pass";
      if (q.verdict !== expectV) bad.push(`${c.label} ${q.direction}: verdict`);
      if (q.q95Ft !== a.queue95Ft || Math.abs(q.q95Veh * QUEUE_FT_PER_VEH - q.q95Ft) > 1e-9) bad.push(`${c.label} ${q.direction}: q95`);
      if (Math.abs(q.avgQueueVeh * Q95_FACTOR - q.q95Veh) > 1e-9) bad.push(`${c.label} ${q.direction}: avg queue`);
      if (Math.abs(q.q95PerLaneFt * q.lanes - q.q95Ft) > 1e-9 || Math.abs(q.avgQueuePerLaneVeh * q.lanes - q.avgQueueVeh) > 1e-9) bad.push(`${c.label} ${q.direction}: per-lane share`);
      if ((a.storageQueueFt ?? null) !== q.storageQueueFt || (a.storageQueueBasis ?? undefined) !== (q.storageQueueBasis ?? undefined)) bad.push(`${c.label} ${q.direction}: storageQueueFt`);
      if (Math.abs(q.satFlowVphpl - SATURATION_FLOW_VPH * q.weatherFactor) > 1e-9) bad.push(`${c.label} ${q.direction}: satFlow × weather`);
      if (!(q.effectiveGreenSec > 0 && q.effectiveGreenSec < q.cycleSec)) bad.push(`${c.label} ${q.direction}: green ${q.effectiveGreenSec} of ${q.cycleSec}`);
      if (q.lanes !== a.throughLanes || q.arrivalVph !== a.vph.build) bad.push(`${c.label} ${q.direction}: lanes/vph`);
    }
    // §03
    if (!m.timing.webster || !(m.timing.webster.cycleLenS > 0) || (m.timing.current === null) !== (drawn.signalTiming === undefined)) bad.push(`${c.label}: timing`);
    if (c.scen && m.timing.changed !== plan.timingChanged) bad.push(`${c.label}: timingChanged`);
    // §04
    if (!m.sim.nobuild || !m.sim.build || m.sim.nobuild.scenario !== "nobuild" || m.sim.build.scenario !== "build") bad.push(`${c.label}: sim inputs`);
    if (m.sim.scenario !== !!c.scen) bad.push(`${c.label}: sim scenario flag`);
    for (const d of DIRECTIONS) {
      const e = m.sim.engine[d];
      const a = plan.approaches.find((x) => x.direction === d);
      if (a && (e.delay.build !== a.delay.build || e.delay.noBuild !== a.delay.noBuild || e.q95Ft.build !== a.queue95Ft)) bad.push(`${c.label} ${d}: engine readout`);
      if (a && (Math.abs(e.delayUncalibrated.build * m.sim.calibrationMultiplier - a.delay.build) > 1e-9)) bad.push(`${c.label} ${d}: uncalibrated readout`);
    }
    if (m.sim.calibrationMultiplier !== calibrationMultiplierOf(drawn) || m.sim.weatherFactor !== weatherFactor || m.sim.build.satFlowVphpl !== SATURATION_FLOW_VPH * weatherFactor) bad.push(`${c.label}: sim model factors`);
    if (m.sim.agreementConditions !== SIM_AGREEMENT_CONDITIONS) bad.push(`${c.label}: agreement conditions`);
    // §05
    if (!deepEq(m.whatIf.edit, timingEditFromRow(drawn))) bad.push(`${c.label}: what-if seed`);
    // §06
    if (m.mitigation.mitigation !== drawn.mitigation || m.mitigation.severity !== drawn.mitigationSeverity || !Array.isArray(m.mitigation.methodNotes) || m.mitigation.methodNotes.length < 3) bad.push(`${c.label}: mitigation`);
    if (c.scen && (!m.mitigation.base || m.mitigation.base.mitigation !== c.row.mitigation)) bad.push(`${c.label}: mitigation base`);
    if (m.sections !== SECTIONS) bad.push(`${c.label}: sections`);
  }
  for (const b of bad.slice(0, 12)) console.log("  " + b);
  ok(bad.length === 0, `${rows} models (base + paired) over ${apps} approaches: every section present, finite, queue/storage flags the plan's`);
}

// ---------------------------------------------------------------------------
console.log("\n4. §02 capacity is the engine's — vph ÷ capacity reproduces the printed v/c, queue95Ft the printed Q95");
{
  let n = 0, badVc = [], badQ = [];
  for (const r of A.affectedIntersections) {
    const m = studyModelFromRow(r, null, { weatherFactor });
    for (const q of m.queuing) {
      n++;
      const src = r.approaches.find((a) => a.direction === q.direction);
      // printed v/c is round2 of vph_unrounded / cap; vph is round1 — allow rounding on both.
      if (Math.abs(q.vOverCRecomputed - src.futureVc) > 0.006) badVc.push(`${r.signalId} ${q.direction}: ${q.vOverCRecomputed.toFixed(4)} vs ${src.futureVc}`);
      if (Math.abs(q.q95RecomputedFt - src.queue95thFt) > 0.3) badQ.push(`${r.signalId} ${q.direction}: ${q.q95RecomputedFt.toFixed(2)} vs ${src.queue95thFt}`);
      const capExpect = SATURATION_FLOW_VPH * q.gOverC * q.lanes * weatherFactor;
      if (Math.abs(q.capacityVph - capExpect) > 1e-9) badVc.push(`${r.signalId} ${q.direction}: cap`);
      if (Math.abs(q.q95NoBuildFt - queue95Ft(src.existingVolumeVph, q.capacityVph, q.cycleSec, q.gOverC)) > 1e-9) badQ.push(`${r.signalId} ${q.direction}: no-build Q95`);
    }
  }
  for (const b of badVc.slice(0, 6)) console.log("  " + b);
  for (const b of badQ.slice(0, 6)) console.log("  " + b);
  ok(badVc.length === 0, `v/c reproduced within rounding on all ${n} approaches (capacity = 1800 × g/C × lanes × ${weatherFactor})`);
  ok(badQ.length === 0, `printed Q95 reproduced within 0.3 ft on all ${n} approaches; no-build Q95 is queue95Ft on the same capacity`);
}

// ---------------------------------------------------------------------------
console.log("\n5. sim inputs build in both scenarios for every row, and run");
{
  let n = 0, bad = [];
  for (const r of A.affectedIntersections) {
    for (const scen of [null, byIdB.get(r.signalId) ?? null]) {
      const m = studyModelFromRow(r, scen, { weatherFactor });
      for (const key of ["nobuild", "build"]) {
        n++;
        const inp = m.sim[key];
        if (!inp || inp.signal.cycleLenSec <= 0 || inp.signal.phases.length < 2) { bad.push(`${r.signalId} ${scen ? "paired" : "base"} ${key}: inputs`); continue; }
        if (nonFinite(inp).length) bad.push(`${r.signalId} ${key}: non-finite inputs`);
        if (key === "build" && scen) {
          const drawn = scen;
          for (const d of DIRECTIONS) {
            const a = drawn.approaches.find((x) => x.direction === d);
            const trips = (drawn.movements ?? []).filter((mv) => mv.approach === d).reduce((s, mv) => s + mv.trips, 0);
            if (a && Math.abs(inp.approaches[d].vph - (a.existingVolumeVph + trips)) > 1e-9) bad.push(`${r.signalId} build ${d}: scenario volumes`);
          }
          if (inp.signal.cycleLenSec !== drawn.signalTiming.cycleLenSec) bad.push(`${r.signalId} build: scenario cycle`);
        }
      }
    }
  }
  for (const b of bad.slice(0, 8)) console.log("  " + b);
  ok(bad.length === 0, `${n} sim input sets built (base + paired × nobuild + build), all finite, scenario rows on their own timing and volumes`);

  // The protected-NS override row: the paired model's build sim carries the
  // protected-left phase and a bay; the base model's does not.
  const prot = B.affectedIntersections.find((r) => r.signalTiming?.leftPhasingNs === "protected");
  ok(!!prot, `found the protected-NS override row in B (${prot?.signalId})`);
  if (prot) {
    const base = A.affectedIntersections.find((r) => r.signalId === prot.signalId);
    const paired = studyModelFromRow(base, prot, { weatherFactor });
    const alone = studyModelFromRow(base, null, { weatherFactor });
    ok(paired.sim.scenario && paired.sim.build.signal.gNsLeft !== undefined && paired.sim.build.approaches.NB.leftBayFt !== undefined && paired.sim.build.signal.source === "override",
      "paired: build sim has a protected NS left phase, a left bay, source override");
    ok(!alone.sim.scenario && alone.sim.build.signal.gNsLeft === undefined && alone.sim.build.approaches.NB.leftBayFt === undefined,
      "base alone: permissive, no bay");
    ok(paired.timing.changed && paired.timing.base?.leftPhasing.ns === "permissive" && paired.timing.current?.leftPhasing.ns === "protected",
      "timing model: base permissive → scenario protected");
    ok(paired.sim.engine.NB.delay.build === prot.approaches.find((a) => a.direction === "NB").futureDelaySec,
      "engine readout compares to the SCENARIO row");
    // And it runs: a short run, finite metrics, conservation.
    const sim = new IntersectionSim(paired.sim.build, 7);
    sim.runCycles(3);
    const mt = sim.metrics();
    ok(nonFinite(mt).length === 0 && mt.arrivals === mt.throughput + mt.onNetwork, `3 cycles run: ${mt.arrivals} arrived = ${mt.throughput} through + ${mt.onNetwork} on network`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n6. §05 controls seed from signalTiming exactly");
{
  let n = 0, bad = [];
  for (const r of [...A.affectedIntersections, ...B.affectedIntersections]) {
    n++;
    const m = studyModelFromRow(r, null, { weatherFactor });
    const e = m.whatIf.edit;
    const t = r.signalTiming;
    if (!t) { if (e !== null) bad.push(`${r.signalId}: edit without timing`); continue; }
    if (!e) { bad.push(`${r.signalId}: no edit`); continue; }
    if (!deepEq(e, timingEditFromRow(r))) bad.push(`${r.signalId}: differs from timingEditFromRow`);
    if (e.cycleLenSec !== t.cycleLenSec) bad.push(`${r.signalId}: cycle`);
    const split = (gc) => Math.max(MIN_SPLIT_S, gc * t.cycleLenSec + LOST_TIME_S);
    if (Math.abs(e.nsThroughSplitS - split(t.gOverCns)) > 1e-9 || Math.abs(e.ewThroughSplitS - split(t.gOverCew)) > 1e-9) bad.push(`${r.signalId}: through splits`);
    if ((t.gOverCnsLeft !== undefined) !== (e.nsLeftSplitS !== undefined) || (t.gOverCewLeft !== undefined) !== (e.ewLeftSplitS !== undefined)) bad.push(`${r.signalId}: left phases`);
    if (m.whatIf.timing !== r.signalTiming) bad.push(`${r.signalId}: timing record identity`);
  }
  for (const b of bad.slice(0, 6)) console.log("  " + b);
  ok(bad.length === 0, `${n} rows: edit === timingEditFromRow(row); cycle and splits are g/C × C + ${LOST_TIME_S} s`);
  const prot = B.affectedIntersections.find((r) => r.signalTiming?.leftPhasingNs === "protected");
  const base = A.affectedIntersections.find((r) => r.signalId === prot.signalId);
  const paired = studyModelFromRow(base, prot, { weatherFactor });
  ok(paired.whatIf.edit.nsLeftSplitS !== undefined && paired.whatIf.baseCycleLenSec === base.signalTiming.cycleLenSec,
    "paired: the seed is the SCENARIO row's plan (protected NS left), the base cycle rides along for the slider readout");
}

// ---------------------------------------------------------------------------
console.log("\n7. Webster comparison reproduces the printed plan on webster rows only");
{
  let webster = 0, matched = 0, wrongClaim = 0, other = 0;
  const misses = [];
  for (const r of A.affectedIntersections) {
    const m = studyModelFromRow(r, null, { weatherFactor });
    if (r.signalTiming?.basis === "webster") {
      webster++;
      if (m.timing.websterInUse) matched++;
      else misses.push(`${r.signalId}: printed ${r.signalTiming.cycleLenSec} s / ${r.signalTiming.gOverCns} / ${r.signalTiming.gOverCew}, recomputed ${m.timing.webster.cycleLenS} s / ${m.timing.webster.gOverCns.toFixed(3)} / ${m.timing.webster.gOverCew.toFixed(3)}`);
    } else {
      other++;
      if (m.timing.websterInUse) wrongClaim++;
    }
  }
  for (const b of misses.slice(0, 6)) console.log("  " + b);
  ok(webster > 0 && matched === webster, `${matched} of ${webster} webster rows: computeSignalTiming on the printed no-build volumes reproduces the printed plan`);
  ok(wrongClaim === 0, `${other} non-webster rows never claim the Webster plan is in use`);
  const w = websterForRow(A.affectedIntersections[0]);
  ok(w.basis === "webster" || w.basis === "screening-default", `websterForRow returns an engine SignalTiming (basis ${w.basis})`);

  // An import (synthesized): lane groups carry the measured L/T/R split and
  // the row its imported cycle. row-math.ts resolveTimingForRow hands the
  // fallback leftVph[d] = approachVph[d] × L/ΣLTR and measuredCycleS — the
  // comparison must pass the same, or it is not the engine's plan.
  const r0 = A.affectedIntersections.find((r) => r.signalTiming?.basis === "webster");
  const imported = structuredClone(r0);
  imported.utdfCycleLenSec = 100;
  const leftVph = {};
  for (const a of imported.approaches) {
    const share = a.direction === "NB" ? 0.30 : a.direction === "SB" ? 0.05 : 0.15;
    const L = Math.round(a.existingVolumeVph * share * 10) / 10, R = Math.round(a.existingVolumeVph * 0.1 * 10) / 10;
    const T = Math.round((a.existingVolumeVph - L - R) * 10) / 10;
    a.laneGroups = [
      { movement: "L", existingVolumeVph: L, addedTripsPeak: 0, futureVolumeVph: L, futureVc: 0.2, queue95thFt: 40 },
      { movement: "T", existingVolumeVph: T, addedTripsPeak: 0, futureVolumeVph: T, futureVc: 0.4, queue95thFt: 120 },
      { movement: "R", existingVolumeVph: R, addedTripsPeak: 0, futureVolumeVph: R, futureVc: 0.1, queue95thFt: 20 },
    ];
    leftVph[a.direction] = a.existingVolumeVph * (L / (L + T + R));
  }
  const approachVph = Object.fromEntries(imported.approaches.map((a) => [a.direction, a.existingVolumeVph]));
  const expect = computeSignalTiming({ approachVph, leftVph, opposingLanes: { ns: 1, ew: 1 }, crossingLanes: { ns: 2, ew: 2 }, measuredCycleS: 100 });
  const without = computeSignalTiming({ approachVph, opposingLanes: { ns: 1, ew: 1 }, crossingLanes: { ns: 2, ew: 2 } });
  const got = websterForRow(imported);
  ok(expect.basis === "measured-cycle" && got.basis === "measured-cycle" && got.cycleLenS === expect.cycleLenS && got.cycleLenS >= 100,
    `import: measuredCycleS 100 passed through → basis ${got.basis}, cycle ${got.cycleLenS} s (Webster alone: ${without.basis} ${without.cycleLenS} s)`);
  ok(JSON.stringify(got) === JSON.stringify(expect), "import: websterForRow === computeSignalTiming(approachVph, leftVph from the lane groups, lanes, measuredCycleS) — the engine's own fallback call");
  ok(got.leftPhasing.ns !== without.leftPhasing.ns || Math.abs(got.gOverCns - without.gOverCns) > 1e-6 || got.cycleLenS !== without.cycleLenS,
    `import: the measured left share and cycle change the plan (NS left ${without.leftPhasing.ns} → ${got.leftPhasing.ns}, NS g/C ${without.gOverCns.toFixed(3)} → ${got.gOverCns.toFixed(3)})`);
  const mImp = studyModelFromRow({ ...imported, signalTiming: { ...imported.signalTiming, basis: "measured-cycle", cycleLenSec: got.cycleLenS, gOverCns: Math.round(got.gOverCns * 1000) / 1000, gOverCew: Math.round(got.gOverCew * 1000) / 1000, gOverCnsExact: got.gOverCns, gOverCewExact: got.gOverCew, leftPhasingNs: got.leftPhasing.ns, leftPhasingEw: got.leftPhasing.ew, ...(got.gOverCnsLeft !== undefined ? { gOverCnsLeft: got.gOverCnsLeft, gOverCnsLeftExact: got.gOverCnsLeft } : {}), ...(got.gOverCewLeft !== undefined ? { gOverCewLeft: got.gOverCewLeft, gOverCewLeftExact: got.gOverCewLeft } : {}) } });
  ok(mImp.timing.websterInUse === true, "import: a printed measured-cycle plan equal to the recomputation is recognised as the plan in use");
}

// ---------------------------------------------------------------------------
console.log("\n8. degenerate rows");
{
  const r0 = A.affectedIntersections[0];
  const bare = studyModelFromRow({ ...r0, approaches: [], signalTiming: undefined, movements: undefined, movementSource: undefined });
  ok(bare.queuing.length === 0 && bare.timing.current === null && bare.whatIf.edit === null && bare.timing.splits === null && nonFinite(bare).length === 0,
    "no approaches / timing / movements: empty, finite sections; no what-if seed without a plan");
  ok(bare.sim.build.signal.assumed === true && bare.queuing.length === 0, "sim falls back to the screening default and says so");
  const noWeather = studyModelFromRow(r0);
  ok(noWeather.queuing.every((q) => q.weatherFactor === 1), "weather factor defaults to 1 when the caller passes none");
}

// ---------------------------------------------------------------------------
console.log("\n9. weather ≠ 1 — a heavy-snow scenario (factor 0.70) paired with its base");
{
  const state = { ...EMPTY_SCENARIO, weather: "heavy_snow" };
  const snow = solveScenario(A, state);
  const wf = scenarioWeatherFactor(A, state);
  ok(wf === 0.7 && snow.weatherCapacityFactor === 0.7 && snow.weatherFactorExact === 0.7, `scenarioWeatherFactor(base, heavy_snow) = ${wf}; the re-solved report carries weatherFactorExact ${snow.weatherFactorExact}`);
  ok(scenarioWeatherFactor(A, EMPTY_SCENARIO) === (A.weatherFactorExact ?? A.weatherCapacityFactor), `scenarioWeatherFactor(base, no weather edit) = the report's own ${scenarioWeatherFactor(A, EMPTY_SCENARIO)}`);
  let n = 0, rows = 0;
  const badVc = [], badQ = [], badFlag = [], badSim = [];
  for (const r of A.affectedIntersections) {
    const sRow = snow.affectedIntersections.find((x) => x.signalId === r.signalId);
    const m = studyModelFromRow(r, sRow, { weatherFactor: wf });
    rows++;
    if (!m.scenario) badFlag.push(r.signalId);
    if (m.sim.weatherFactor !== wf || Math.abs(m.sim.build.satFlowVphpl - SATURATION_FLOW_VPH * wf) > 1e-9 || !m.sim.build.notes.some((x) => /weather 0\.70/.test(x))) badSim.push(r.signalId);
    for (const q of m.queuing) {
      n++;
      const src = sRow.approaches.find((a) => a.direction === q.direction);
      if (Math.abs(q.vOverCRecomputed - src.futureVc) > 0.006) badVc.push(`${r.signalId} ${q.direction}: ${q.vOverCRecomputed.toFixed(4)} vs ${src.futureVc}`);
      if (Math.abs(q.q95RecomputedFt - src.queue95thFt) > 0.3) badQ.push(`${r.signalId} ${q.direction}: ${q.q95RecomputedFt.toFixed(2)} vs ${src.queue95thFt}`);
      if (Math.abs(q.capacityVph - SATURATION_FLOW_VPH * q.gOverC * q.lanes * wf) > 1e-9 || q.weatherFactor !== wf) badVc.push(`${r.signalId} ${q.direction}: cap`);
    }
  }
  for (const b of [...badVc, ...badQ].slice(0, 6)) console.log("  " + b);
  ok(badFlag.length === 0, `${rows} paired models all flagged scenario (every row moved under snow)`);
  ok(badVc.length === 0, `capacity at the scenario's 0.70 reproduces the snow row's printed v/c on all ${n} approaches`);
  ok(badQ.length === 0, `queue95Ft at the scenario's 0.70 reproduces the snow row's printed Q95 on all ${n} approaches`);
  ok(badSim.length === 0, "the sim inputs discharge at 1800 × 0.70 and disclose it");
  // The M3 bug, pinned: the same pairs at the BASE's factor do not reproduce the scenario rows.
  let wrong = 0;
  for (const r of A.affectedIntersections) {
    const sRow = snow.affectedIntersections.find((x) => x.signalId === r.signalId);
    const m = studyModelFromRow(r, sRow, { weatherFactor: A.weatherFactorExact ?? 1 });
    for (const q of m.queuing) { const src = sRow.approaches.find((a) => a.direction === q.direction); if (Math.abs(q.vOverCRecomputed - src.futureVc) > 0.006) wrong++; }
  }
  ok(wrong > n / 2, `at the base's factor ${A.weatherFactorExact ?? 1} the same pairs miss the printed v/c on ${wrong} of ${n} approaches — the study must use the scenario's factor`);
}

// ---------------------------------------------------------------------------
console.log("\n10. two through lanes — per-lane marks, approach-total readout");
{
  const r = A.affectedIntersections.find((x) => x.signalId === "ATL-69421271") ?? A.affectedIntersections[0];
  const two = structuredClone(r);
  for (const a of two.approaches) { a.throughLanes = 2; a.lanesSource = "import"; }
  const one = studyModelFromRow(r, null, { weatherFactor });
  const m = studyModelFromRow(two, null, { weatherFactor });
  let bad = [];
  for (const q of m.queuing) {
    const q1 = one.queuing.find((x) => x.direction === q.direction);
    const src = two.approaches.find((a) => a.direction === q.direction);
    if (q.lanes !== 2 || Math.abs(q.capacityVph - 2 * q1.capacityVph) > 1e-9 || Math.abs(q.capacityPerLaneVph - q1.capacityPerLaneVph) > 1e-9) bad.push(`${q.direction}: capacity`);
    if (Math.abs(q.arrivalPerLaneVph - q.arrivalVph / 2) > 1e-9) bad.push(`${q.direction}: λ per lane`);
    if (q.q95Ft !== src.queue95thFt || Math.abs(q.q95PerLaneFt - src.queue95thFt / 2) > 1e-9 || Math.abs(q.q95PerLaneVeh - q.q95Veh / 2) > 1e-9) bad.push(`${q.direction}: Q95 per lane`);
    if (Math.abs(q.avgQueuePerLaneVeh - q.avgQueueVeh / 2) > 1e-9 || Math.abs(q.avgQueuePerLaneFt - q.avgQueueFt / 2) > 1e-9) bad.push(`${q.direction}: Q1 per lane`);
    if (Math.abs(q.endOfRedMeanPerLaneVeh - (q.arrivalVph / 2 / 3600) * (q.cycleSec - q.effectiveGreenSec)) > 1e-9) bad.push(`${q.direction}: λ(C−g)`);
    const e = m.sim.engine[q.direction];
    if (e.q95Ft.build !== src.queue95thFt || e.q95Ft.noBuild !== q.q95NoBuildFt) bad.push(`${q.direction}: engine readout must stay the approach total`);
    if (m.sim.build.approaches[q.direction].throughLanes !== 2 || m.sim.nobuild.approaches[q.direction].throughLanes !== 2) bad.push(`${q.direction}: sim lanes`);
    // The recomputed queue on the doubled capacity is smaller than the printed (one-lane) one — the model recomputes, never rescales.
    if (!(q.q95RecomputedFt < q1.q95RecomputedFt)) bad.push(`${q.direction}: recomputed Q95 should fall with the doubled capacity`);
  }
  for (const b of bad.slice(0, 6)) console.log("  " + b);
  ok(bad.length === 0, `${m.queuing.length} approaches at 2 lanes: capacity × 2, λ ÷ 2, Q95 ÷ 2 and Q1 ÷ 2 for the lane marks, engine readout = printed approach total, sim inputs 2 lanes`);
  ok(one.queuing.every((q) => q.lanes === 1 && q.q95PerLaneFt === q.q95Ft && q.avgQueuePerLaneVeh === q.avgQueueVeh), "one-lane row: per-lane marks equal the approach figures");
}

// ---------------------------------------------------------------------------
console.log("\n11. like-for-like labels and quantities");
{
  // m10: λ(C−g) per lane × 1/(1 − x·g/C) × 1.65 × 25 ft = the recomputed Q95 per lane — the engine's own identity, on every approach.
  let n = 0, bad = 0;
  for (const r of A.affectedIntersections) {
    const m = studyModelFromRow(r, null, { weatherFactor });
    for (const q of m.queuing) {
      n++;
      const x = Math.min(0.99, q.arrivalVph / q.capacityVph);
      const q95PerLane = (q.endOfRedMeanPerLaneVeh / Math.max(0.05, 1 - x * q.gOverC)) * Q95_FACTOR * QUEUE_FT_PER_VEH;
      if (Math.abs(q95PerLane - q.q95RecomputedFt / q.lanes) > 1e-6) bad++;
    }
  }
  ok(bad === 0, `end-of-red mean λ(C−g) × 1/(1 − x·g/C) × ${Q95_FACTOR} × ${QUEUE_FT_PER_VEH} ft = queue95Ft ÷ lanes on all ${n} approaches (the two quantities differ by exactly the engine's factor)`);

  // m7: calibration divided back out, clamped as the engine clamps it.
  const r0 = A.affectedIntersections[0];
  const cal = studyModelFromRow({ ...r0, calibration: { sampleCount: 3, delayMultiplier: 1.3, delayMultiplierExact: 1.3 } }, null, { weatherFactor });
  const a0 = r0.approaches[0];
  ok(cal.sim.calibrationMultiplier === 1.3 && Math.abs(cal.sim.engine[a0.direction].delayUncalibrated.build - a0.futureDelaySec / 1.3) < 1e-9 && cal.sim.engine[a0.direction].delay.build === a0.futureDelaySec,
    `calibrated row (×1.3): engine readout ${cal.sim.engine[a0.direction].delayUncalibrated.build.toFixed(2)} s = printed ${a0.futureDelaySec} ÷ 1.3; the printed figure is kept beside it`);
  ok(calibrationMultiplierOf({ calibration: { sampleCount: 1, delayMultiplier: 9 } }) === 5 && calibrationMultiplierOf({ calibration: { sampleCount: 1, delayMultiplier: 0.1 } }) === 0.25 && calibrationMultiplierOf({}) === 1,
    "the multiplier is clamped to the engine's 0.25–5 and is 1 without calibration");

  // m9: an imported cycle with no plan sizes §02 and the sim on that cycle.
  const bareImport = { ...r0, signalTiming: undefined, utdfCycleLenSec: 120 };
  const bi = studyModelFromRow(bareImport, null, { weatherFactor });
  const q0 = bi.queuing[0], src0 = bareImport.approaches[0];
  ok(bi.queuing.every((q) => q.timingAssumed && q.cycleSec === 120 && q.gOverC === 0.45) && bi.sim.build.signal.cycleLenSec === 120 && bi.sim.build.signal.assumed,
    "no plan + utdfCycleLenSec 120: §02 cycle 120 s at g/C 0.45, the sim on 120 s, both flagged assumed");
  ok(Math.abs(q0.q95RecomputedFt - queue95Ft(src0.futureVolumeVph, q0.capacityVph, 120, 0.45)) < 1e-9 && q0.q95RecomputedFt !== queue95Ft(src0.futureVolumeVph, q0.capacityVph, 90, 0.45),
    `no plan + imported cycle: Q95 recomputed on 120 s (${q0.q95RecomputedFt.toFixed(1)} ft), not the 90 s default (${queue95Ft(src0.futureVolumeVph, q0.capacityVph, 90, 0.45).toFixed(1)} ft)`);
  ok(bi.mitigation.methodNotes.some((x) => /imported 120 s cycle/.test(x)), "the method notes say the capacity was sized on the imported cycle");

  // m16: an edit on ANOTHER signal is not a scenario for this one.
  const ra = A.affectedIntersections[0], rb = A.affectedIntersections[1];
  const edited = solveScenario(A, { ...EMPTY_SCENARIO, timing: { [ra.signalId]: { ...timingEditFromRow(ra), cycleLenSec: ra.signalTiming.cycleLenSec + 30 } } });
  const aS = edited.affectedIntersections.find((x) => x.signalId === ra.signalId), bS = edited.affectedIntersections.find((x) => x.signalId === rb.signalId);
  const mb = studyModelFromRow(rb, bS, { weatherFactor }), ma = studyModelFromRow(ra, aS, { weatherFactor });
  ok(bS !== rb && !scenarioRowDiffers(rb, bS) && mb.scenario === false && mb.summary.base === undefined && mb.sim.scenario === false,
    `${rb.signalId}: a fresh but identical scenario row (edit on ${ra.signalId}) is not a scenario — no "· scenario", no base pairs`);
  ok(scenarioRowDiffers(ra, aS) && ma.scenario === true && ma.timing.changed && ma.summary.base !== undefined,
    `${ra.signalId}: the edited signal is a scenario (timing changed, base pairs present)`);

  // m12 / m14: the storage flag compares the queue the plan names, and the
  // model carries it. A row-level bay on the LIGHTEST approach, sized between
  // that approach's own Q95 and the row's worst: the PDF's comparison flags
  // it (worst > bay); the approach's own would not.
  const lightest = [...r0.approaches].sort((a, b) => a.queue95thFt - b.queue95thFt)[0];
  const bayFt = Math.round((lightest.queue95thFt + r0.queue95thFt) / 2);
  ok(lightest.queue95thFt < bayFt && bayFt < r0.queue95thFt, `a ${bayFt} ft bay sits between ${lightest.direction}'s own Q95 ${lightest.queue95thFt} ft and the row's worst ${r0.queue95thFt} ft`);
  const rowBay = { ...r0, existingStorageFt: bayFt, storageMovement: `${lightest.direction}L` };
  const mBay = studyModelFromRow(rowBay, null, { weatherFactor });
  const qb = mBay.queuing.find((q) => q.direction === lightest.direction);
  ok(qb.storageFt === bayFt && qb.storageBasis === "row" && qb.storageQueueFt === r0.queue95thFt && qb.storageQueueBasis === "row worst approach" && qb.storageDeficient === true && qb.verdict === "fail",
    `row-level ${rowBay.storageMovement} bay: flagged against the row's worst-approach Q95 ${r0.queue95thFt} ft (the PDF's comparison) — this approach's own ${qb.q95Ft} ft would have fit`);

  // M5 / m11: what the page says.
  ok(ENGINE_RECOMPUTATIONS.length === 5 && ENGINE_RECOMPUTATIONS.every((x) => /§0(1a|2|3)/.test(x)), `§00 names ${ENGINE_RECOMPUTATIONS.length} engine recomputations, each with its section`);
  ok(/v\/c ≤ 0\.7/.test(SIM_AGREEMENT_CONDITIONS) && /no-build/.test(SIM_AGREEMENT_CONDITIONS) && /Webster/.test(SIM_AGREEMENT_CONDITIONS) && /uncalibrated/.test(SIM_AGREEMENT_CONDITIONS) && /seed 42/.test(SIM_AGREEMENT_CONDITIONS) && /30 cycles/.test(SIM_AGREEMENT_CONDITIONS),
    "the ±40 % caption states exactly the check's conditions (no-build, Webster basis, v/c ≤ 0.7, uncalibrated, seed 42, 30 cycles)");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-study passed");
process.exit(failed ? 1 : 0);
