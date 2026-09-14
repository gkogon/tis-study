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
//      screening-default or override row.
//
// Run: `pnpm run check:intersection-study` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studyModelFromRow, SECTIONS, Q95_FACTOR, websterForRow } from "../src/lib/intersection-study-model.ts";
import { planFromRow, DIRECTIONS, QUEUE_FT_PER_VEH } from "../src/lib/intersection-geometry.ts";
import { timingEditFromRow, LOST_TIME_S, MIN_SPLIT_S } from "../src/lib/scenario-solve.ts";
import { IntersectionSim } from "../src/lib/intersection-sim.ts";
import { SATURATION_FLOW_VPH, queue95Ft } from "@workspace/tis-engine-core";

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
ok(SECTIONS.length === 7 && SECTIONS.map((s) => s.n).join() === "00,01,02,03,04,05,06", "seven sections §00–§06 in order");

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
    }
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

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-study passed");
process.exit(failed ? 1 : 0);
