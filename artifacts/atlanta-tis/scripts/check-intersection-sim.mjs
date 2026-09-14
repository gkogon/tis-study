// Headless checks for the intersection micro-simulation (src/lib/intersection-sim.ts).
//
// Real rows from scripts/fixtures (this branch's engine output, see
// fixtures/README.md) drive every scenario-level check; synthetic inputs are
// used only where the property needs a signal no real row has (a continuous
// green for saturation flow).
//
//  (a) conservation      after 30 cycles, arrivals = departures + on-network,
//                        per approach, in both scenarios — and on an
//                        oversaturated row whose queue spills into the entry
//                        buffer.
//  (b) determinism       the same seed twice → identical metrics and cars;
//                        a different seed → different metrics.
//  (c) no NaN            every row of the base fixture, both scenarios, 10
//                        cycles: no NaN/Infinity in inputs, metrics or cars.
//  (d) protected lefts   on the overrides fixture's protected-NS row, at every
//                        sub-step of a 30-cycle run, a protected left is never
//                        green while its opposing through is green (and the
//                        left phase does turn green, so the check is not vacuous).
//  (e) saturation flow   a standing queue under continuous green discharges at
//                        1800 vphpl ± 5 % (one lane and two lanes). The
//                        headway is 3600 / SATURATION_FLOW_VPH.
//  (e′) effective green  a saturated lane on a cycled signal discharges
//                        (displayed green ± 1.5 s) / 2.0 s vehicles per cycle:
//                        start-up lost time and the extension into yellow net
//                        out, so the sim's capacity is the engine's 1800 × g/C.
//  (f) Webster band      on a real row with v/c ≤ 0.7 on every approach, the
//                        simulated mean control delay over 30 cycles lands
//                        within ±40 % of vcToDelay(v/c, capacity, cycle, g/C)
//                        for that approach, where capacity = 1800 × g/C ×
//                        through lanes exactly as row-math.ts approachCap()
//                        computes it (the recomputed engine figure is also
//                        checked against the row's printed delay). The band is
//                        wide on purpose: the sim is a stochastic measurement
//                        (Poisson arrivals, kinematic start-up, one 30-cycle
//                        sample) of the process Webster d1 + Akçelik d2
//                        describe analytically. The same band is then swept
//                        over every qualifying row in the fixture at 60
//                        cycles (twice the sample, so the 148-approach sweep
//                        keeps a durable margin: 0.77–1.23 across seeds).
//  (h) inputs            what simInputsFromRow reads: the engine's 10/80/10
//                        split and one-lane default on a plain row; measured
//                        shares, lane counts and bay storage when a row
//                        carries laneGroups (no fixture row does — the base
//                        row is extended in memory with a lane-group table);
//                        the governing existingStorageFt when storageMovement
//                        names that left; the studio's timing override; the
//                        screening default when a row has no timing at all.
//  (g) build ≥ no-build  on the approach that receives the most project
//                        trips, the build scenario's simulated delay is at
//                        least the no-build's, as a mean over 8 seeds. Each
//                        seed shares its background arrival stream between
//                        the two scenarios (the project stream only adds
//                        vehicles), but the comparison is still statistical:
//                        an added vehicle shifts the platoon's 2 s cadence,
//                        which changes WHICH vehicle is the last to make the
//                        yellow, so a single seed can tie or dip by a few
//                        hundredths of a second on a +21 vph load whose
//                        engine delta is +0.5 s.
//  (w) weather           the designated row solved at weather factor 0.86
//                        (heavy rain / light snow): the sim's saturation flow
//                        is 1800 × 0.86 = 1548 vphpl (a standing queue under
//                        continuous green discharges at that rate ± 5 %), the
//                        default is disclosed in notes, and the simulated
//                        delay lands within the band of vcToDelay on the
//                        WEATHER-ADJUSTED capacity (1548 × g/C × lanes) —
//                        like for like with a rain-solved row — while the
//                        delay on every approach rises against clear weather.
//  (l) lanes             the designated row with throughLanes = 2 synthesized
//                        on every approach: the simulated delay is within the
//                        band of vcToDelay on the doubled capacity; the sim's
//                        Q95 is the APPROACH TOTAL across lanes (the engine's
//                        queue95Ft basis) and lands within the band of the
//                        engine's queue95Ft, while the worst single lane sits
//                        between total ÷ lanes and total; on the one-lane row
//                        total and worst lane are the same number.
//  (t) analysis period   ANALYSIS_PERIOD_S is the engine's T = 0.25 h, and a
//                        run over exactly that window (what the view shows)
//                        still lands within the band on the designated row.
//
// Run: `pnpm run check:intersection-sim` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  simInputsFromRow, IntersectionSim, DIRECTIONS, OPPOSING,
  SIM_DT, SAT_HEADWAY_S, YELLOW_S, ALL_RED_S, APPROACH_LEN_FT, ANALYSIS_PERIOD_S,
} from "../src/lib/intersection-sim.ts";
import { vcToDelay, queue95Ft, SATURATION_FLOW_VPH } from "@workspace/tis-engine-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", n), "utf8"));
const BASE = load("scenario-base.json");
const OVERRIDES = load("scenario-overrides.json");

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

const CYCLES = 30;
const SEED = 42;
const BAND = 0.40;

const isNs = (d) => d === "NB" || d === "SB";
/** Engine capacity for an approach: row-math.ts approachCap() = s × g/C × lanes × weather (1 in the fixture; the inputs carry the factor they were built with). */
const engineFor = (inputs, d) => {
  const a = inputs.approaches[d];
  const gc = (isNs(d) ? inputs.signal.gNs : inputs.signal.gEw) / inputs.signal.cycleLenSec;
  const cap = SATURATION_FLOW_VPH * gc * a.throughLanes * (inputs.weatherFactor ?? 1);
  const vc = a.vph / cap;
  return { vc, cap, gc, delay: vcToDelay(vc, cap, inputs.signal.cycleLenSec, gc), q95Ft: queue95Ft(a.vph, cap, inputs.signal.cycleLenSec, gc) };
};
const hasBadNumber = (x, seen = new Set()) => {
  if (typeof x === "number") return !Number.isFinite(x);
  if (x && typeof x === "object") {
    if (seen.has(x)) return false;
    seen.add(x);
    for (const v of Object.values(x)) if (hasBadNumber(v, seen)) return true;
  }
  return false;
};
const run = (row, scenario, seed = SEED, cycles = CYCLES, opts = {}) => {
  const inputs = simInputsFromRow(row, scenario, opts);
  const sim = new IntersectionSim(inputs, seed);
  sim.runCycles(cycles);
  return { inputs, sim, m: sim.metrics() };
};
const inBand = (ratio) => ratio >= 1 - BAND && ratio <= 1 + BAND;

// The designated undersaturated row: webster timing, v/c ≤ 0.7 on every approach.
const ROW_ID = "ATL-69421271";
const row = BASE.affectedIntersections.find((r) => r.signalId === ROW_ID);
ok(!!row && row.signalTiming?.basis === "webster" && row.approaches.every((a) => a.existingVc <= 0.7),
  `fixture row ${ROW_ID} has webster timing and v/c ≤ 0.7 on every approach`);

// ---------------------------------------------------------------- (a) conservation
console.log("\n(a) conservation");
for (const scenario of ["nobuild", "build"]) {
  const { m } = run(row, scenario);
  ok(m.cycles === CYCLES, `${scenario}: ${m.cycles} cycles completed`);
  ok(m.arrivals === m.throughput + m.onNetwork && m.arrivals > 0,
    `${scenario}: arrivals ${m.arrivals} = departures ${m.throughput} + on-network ${m.onNetwork}`);
  ok(DIRECTIONS.every((d) => m.approaches[d].arrivals === m.approaches[d].throughput + m.approaches[d].onNetwork),
    `${scenario}: conserved on every approach`);
}
{
  const over = BASE.affectedIntersections.find((r) => r.signalTiming?.basis === "screening-default" && r.approaches.some((a) => a.futureVc > 1.2));
  ok(!!over, `an oversaturated screening-default row exists (${over?.signalId}, worst v/c ${Math.max(...over.approaches.map((a) => a.futureVc))})`);
  const { m } = run(over, "build");
  const spilled = DIRECTIONS.some((d) => m.approaches[d].q95Ft > APPROACH_LEN_FT);
  ok(spilled, `its queue spills past the ${APPROACH_LEN_FT} ft approach into the entry buffer (worst Q95 ${f1(Math.max(...DIRECTIONS.map((d) => m.approaches[d].q95Ft)))} ft)`);
  ok(m.arrivals === m.throughput + m.onNetwork, `still conserved: ${m.arrivals} = ${m.throughput} + ${m.onNetwork}`);
  ok(DIRECTIONS.every((d) => m.approaches[d].simDelaySec > 80), `every approach simulates LOS F delay (${DIRECTIONS.map((d) => f1(m.approaches[d].simDelaySec)).join(" / ")} s)`);
}

// ---------------------------------------------------------------- (b) determinism
console.log("\n(b) determinism");
{
  const A1 = run(row, "build", 7), A2 = run(row, "build", 7), B1 = run(row, "build", 8);
  ok(JSON.stringify(A1.m) === JSON.stringify(A2.m), "same seed twice → identical metrics");
  ok(JSON.stringify(A1.sim.cars()) === JSON.stringify(A2.sim.cars()), "same seed twice → identical cars");
  ok(JSON.stringify(A1.sim.phase()) === JSON.stringify(A2.sim.phase()), "same seed twice → identical phase");
  ok(JSON.stringify(A1.m) !== JSON.stringify(B1.m), "a different seed → different metrics");
  // Frame-rate independence: stepping in ragged dt reaches the same state as fixed sub-steps.
  const inputs = simInputsFromRow(row, "build");
  const s1 = new IntersectionSim(inputs, 7), s2 = new IntersectionSim(inputs, 7);
  for (let i = 0; i < 400; i++) s1.step(SIM_DT);
  let left = 400 * SIM_DT;
  const ragged = [0.017, 0.033, 0.25, 0.1];
  for (let i = 0; left > 1e-9; i++) { const dt = Math.min(left, ragged[i % ragged.length]); s2.step(dt); left -= dt; }
  ok(JSON.stringify(s1.metrics()) === JSON.stringify(s2.metrics()) && JSON.stringify(s1.cars()) === JSON.stringify(s2.cars()),
    `ragged frame dts reach the same state as fixed ${SIM_DT} s sub-steps`);
}

// ---------------------------------------------------------------- (c) no NaN
console.log("\n(c) no NaN");
{
  let bad = 0, rows = 0;
  for (const r of BASE.affectedIntersections) {
    for (const scenario of ["nobuild", "build"]) {
      const { inputs, sim, m } = run(r, scenario, 3, 10);
      if (hasBadNumber(inputs) || hasBadNumber(m) || hasBadNumber(sim.cars()) || hasBadNumber(sim.phase())) bad++;
    }
    rows++;
  }
  ok(bad === 0, `no NaN/Infinity in inputs, metrics, cars or phase across ${rows} fixture rows × 2 scenarios × 10 cycles`);
}

// ---------------------------------------------------------------- (d) protected lefts
console.log("\n(d) protected lefts never overlap the opposing through");
{
  const prot = OVERRIDES.affectedIntersections.find((r) => r.signalTiming?.leftPhasingNs === "protected" || r.signalTiming?.leftPhasingEw === "protected");
  ok(!!prot, `overrides fixture has a protected-left row (${prot?.signalId}: NS ${prot?.signalTiming?.leftPhasingNs}, EW ${prot?.signalTiming?.leftPhasingEw})`);
  const inputs = simInputsFromRow(prot, "build");
  const protectedDirs = DIRECTIONS.filter((d) => (isNs(d) ? inputs.signal.gNsLeft : inputs.signal.gEwLeft) !== undefined);
  ok(protectedDirs.length > 0 && inputs.signal.phases.some((p) => p.key === "nsL" || p.key === "ewL"),
    `sim inputs carry a protected-left phase for ${protectedDirs.join("/")} (${inputs.signal.phases.map((p) => `${p.key} ${f1(p.greenSec)} s`).join(", ")})`);
  ok(protectedDirs.every((d) => inputs.approaches[d].leftBayFt !== undefined), `every protected approach gets a left-turn bay (${protectedDirs.map((d) => `${d} ${inputs.approaches[d].leftBayFt} ft${inputs.approaches[d].leftBayAssumed ? " assumed" : ""}`).join(", ")})`);
  const sim = new IntersectionSim(inputs, SEED);
  let overlaps = 0, leftGreenSteps = 0, steps = 0, bayUsed = false;
  while (sim.cyclesCompleted() < CYCLES) {
    sim.step(SIM_DT);
    steps++;
    const ph = sim.phase();
    for (const d of protectedDirs) {
      if (ph.lights[d].L === "G") {
        leftGreenSteps++;
        if (ph.lights[OPPOSING[d]].T !== "R") overlaps++;
      }
    }
    if (!bayUsed) bayUsed = sim.cars().some((c) => c.lane === -1);
  }
  ok(overlaps === 0, `0 of ${steps} sub-steps show a protected left green with its opposing through green (left green on ${leftGreenSteps} sub-steps)`);
  ok(leftGreenSteps > 0, "the protected-left phase does turn green");
  ok(bayUsed, "left-turning vehicles use the bay lane");
  const m = sim.metrics();
  ok(m.arrivals === m.throughput + m.onNetwork, `protected-left run conserved: ${m.arrivals} = ${m.throughput} + ${m.onNetwork}`);
}

// ---------------------------------------------------------------- (e) saturation flow
console.log("\n(e) saturation flow");
const synthetic = ({ vphNB, lanes = 1, cycle, greenNs, greenEw = 0, weatherFactor = 1 }) => {
  const ap = (d, vph) => ({
    direction: d, vph, throughLanes: lanes, lanesSource: "default", leftShare: 0, rightShare: 0,
    movementVph: { L: 0, T: vph, R: 0 }, backgroundVph: { L: 0, T: vph, R: 0 }, projectTrips: { L: 0, T: 0, R: 0 }, splitSource: "default",
  });
  const phases = [{ key: "ns", greenSec: greenNs }];
  if (greenEw > 0) phases.push({ key: "ew", greenSec: greenEw });
  const used = phases.reduce((s, p) => s + p.greenSec + YELLOW_S + ALL_RED_S, 0);
  return {
    signalId: "synthetic", name: "synthetic", scenario: "nobuild",
    approaches: { NB: ap("NB", vphNB), SB: ap("SB", 0), EB: ap("EB", 0), WB: ap("WB", 0) },
    signal: { cycleLenSec: cycle, gNs: greenNs, gEw: greenEw, yellowSec: YELLOW_S, allRedSec: ALL_RED_S, basis: "webster", assumed: false, phases, slackSec: cycle - used },
    weatherFactor, satFlowVphpl: SATURATION_FLOW_VPH * weatherFactor,
    notes: [],
  };
};
const measured = {};
for (const [lanes, weatherFactor] of [[1, 1], [2, 1], [1, 0.86]]) {
  // One 3595 s green in a 3600 s cycle = continuous green for the whole run. Demand far above capacity keeps the queue standing.
  const sim = new IntersectionSim(synthetic({ vphNB: 3000 * lanes, lanes, cycle: 3600, greenNs: 3595, weatherFactor }), 3);
  sim.step(120);
  const before = sim.metrics().throughput;
  sim.step(600);
  const n = sim.metrics().throughput - before;
  const vphpl = (n * 6) / lanes;
  const target = SATURATION_FLOW_VPH * weatherFactor;
  measured[`sat${lanes}w${weatherFactor}`] = vphpl;
  ok(Math.abs(vphpl - target) <= 0.05 * target,
    `${lanes} lane${lanes > 1 ? "s" : ""}${weatherFactor !== 1 ? `, weather ${weatherFactor}` : ""}: ${n} vehicles in 600 s of continuous green = ${vphpl.toFixed(0)} vphpl (target ${target} ± 5 %, headway ${sim.satHeadwayS.toFixed(3)} s${weatherFactor === 1 ? ` = SAT_HEADWAY_S ${SAT_HEADWAY_S}` : ""})`);
}
console.log("\n(e′) effective green");
for (const g of [20, 26.2, 40]) {
  const C = 60;
  const sim = new IntersectionSim(synthetic({ vphNB: 3000, cycle: C, greenNs: g, greenEw: C - g - 2 * (YELLOW_S + ALL_RED_S) }), 3);
  sim.runCycles(5);
  const before = sim.metrics().throughput;
  sim.runCycles(40);
  const perCycle = (sim.metrics().throughput - before) / 40;
  const eff = perCycle * SAT_HEADWAY_S;
  ok(Math.abs(eff - g) <= 1.5, `displayed green ${g} s: ${perCycle.toFixed(2)} veh/cycle → effective green ${f1(eff)} s (± 1.5 s)`);
}

// ---------------------------------------------------------------- (f) Webster band
console.log(`\n(f) simulated delay within ±${BAND * 100} % of vcToDelay — row ${ROW_ID}`);
{
  const { inputs, m } = run(row, "nobuild");
  ok(inputs.signal.basis === "webster" && !inputs.signal.assumed, `timing from the row: ${inputs.signal.cycleLenSec} s cycle, NS g ${f1(inputs.signal.gNs)} s, EW g ${f1(inputs.signal.gEw)} s`);
  for (const d of DIRECTIONS) {
    const e = engineFor(inputs, d);
    const a = row.approaches.find((x) => x.direction === d);
    ok(Math.abs(e.delay - a.existingDelaySec) <= 0.06, `${d}: recomputed engine delay ${e.delay.toFixed(2)} s matches the row's printed ${a.existingDelaySec} s (cap ${e.cap.toFixed(1)} vph, v/c ${e.vc.toFixed(3)})`);
    const sim = m.approaches[d].simDelaySec;
    const ratio = sim / e.delay;
    ok(ratio >= 1 - BAND && ratio <= 1 + BAND,
      `${d}: sim ${f1(sim)} s vs engine ${f1(e.delay)} s → ${(ratio * 100).toFixed(0)} % (${m.approaches[d].throughput} vehicles, ${inputs.approaches[d].vph.toFixed(0)} vph; stopped+slowed ${f1(m.approaches[d].stoppedDelaySec)} s; Q95 sim ${m.approaches[d].q95Ft.toFixed(0)} ft vs row ${a.queue95thFt} ft)`);
  }
  // Sweep: every row with webster timing and v/c ≤ 0.7 on every approach.
  const ratios = [];
  for (const r of BASE.affectedIntersections) {
    if (r.signalTiming?.basis !== "webster" || !r.approaches.every((a) => a.existingVc <= 0.7)) continue;
    const { inputs: inp, m: mm } = run(r, "nobuild", SEED, 2 * CYCLES);
    for (const d of DIRECTIONS) ratios.push({ id: r.signalId, d, r: mm.approaches[d].simDelaySec / engineFor(inp, d).delay });
  }
  const worst = ratios.reduce((w, x) => (Math.abs(x.r - 1) > Math.abs(w.r - 1) ? x : w), ratios[0]);
  const mean = ratios.reduce((s, x) => s + x.r, 0) / ratios.length;
  ok(ratios.length >= 100 && ratios.every((x) => x.r >= 1 - BAND && x.r <= 1 + BAND),
    `sweep (${2 * CYCLES} cycles): ${ratios.length} approaches on ${new Set(ratios.map((x) => x.id)).size} qualifying rows all inside the band (mean ${(mean * 100).toFixed(0)} %, worst ${worst.id} ${worst.d} ${(worst.r * 100).toFixed(0)} %)`);
}

// ---------------------------------------------------------------- (h) inputs
console.log("\n(h) inputs from the row");
{
  const plain = simInputsFromRow(row, "build");
  ok(DIRECTIONS.every((d) => plain.approaches[d].splitSource === "default" && plain.approaches[d].throughLanes === 1 && plain.approaches[d].lanesSource === "default"),
    "plain row: background split is the engine's default convention, one through lane, no bay");
  ok(DIRECTIONS.every((d) => Math.abs(plain.approaches[d].backgroundVph.L / Math.max(1e-9, plain.approaches[d].vph - Object.values(plain.approaches[d].projectTrips).reduce((s, x) => s + x, 0)) - 0.10) < 1e-9),
    "plain row: left share 0.10 of background (DEFAULT_LEFT_TURN_SHARE)");
  ok(DIRECTIONS.every((d) => plain.approaches[d].leftBayFt === undefined), "plain row (permissive, no lane groups): no left-turn bay");
  const trips = (d) => (row.movements ?? []).filter((m) => m.approach === d).reduce((s, m) => s + m.trips, 0);
  ok(DIRECTIONS.every((d) => Math.abs(plain.approaches[d].vph - (row.approaches.find((a) => a.direction === d).existingVolumeVph + trips(d))) < 1e-9),
    `build: approach vph = no-build + Σ movements[] trips (${DIRECTIONS.map((d) => `${d} +${trips(d)}`).join(", ")})`);
  const nobuild = simInputsFromRow(row, "nobuild");
  ok(DIRECTIONS.every((d) => Object.values(nobuild.approaches[d].projectTrips).every((x) => x === 0) && Math.abs(nobuild.approaches[d].vph - row.approaches.find((a) => a.direction === d).existingVolumeVph) < 1e-9),
    "no-build: no project trips, vph = the row's existingVolumeVph (opening-year no-build)");
  ok(plain.notes.some((n) => /L\/T\/R convention/.test(n)) && plain.notes.some((n) => /default to 1/.test(n)), "defaults are disclosed in notes");

  // A lane-group row: extend the real row in memory the way a Synchro import would.
  const withLg = structuredClone(row);
  const nb = withLg.approaches.find((a) => a.direction === "NB");
  nb.throughLanes = 2; nb.lanesSource = "import";
  nb.laneGroups = [
    { movement: "L", existingVolumeVph: 60, addedTripsPeak: 0, futureVolumeVph: 60, futureVc: 0.2, queue95thFt: 50, storageFt: 175, lanes: 1, lanesSource: "import" },
    { movement: "T", existingVolumeVph: 300, addedTripsPeak: 5, futureVolumeVph: 305, futureVc: 0.3, queue95thFt: 120, lanes: 2, lanesSource: "import" },
    { movement: "R", existingVolumeVph: 40, addedTripsPeak: 0, futureVolumeVph: 40, futureVc: 0.1, queue95thFt: 30 },
  ];
  withLg.existingStorageFt = 140; withLg.storageMovement = "SBL";
  // A consistent 3-phase plan: Σ greens = cycle − 3 × 5 s lost time.
  const C0 = withLg.signalTiming.cycleLenSec, gcEw = withLg.signalTiming.gOverCewExact, gcNsL = 0.12;
  withLg.signalTiming = { ...withLg.signalTiming, leftPhasingNs: "protected", gOverCnsLeft: gcNsL, gOverCnsLeftExact: gcNsL,
    gOverCns: (C0 - 3 * 5) / C0 - gcEw - gcNsL, gOverCnsExact: (C0 - 3 * 5) / C0 - gcEw - gcNsL, criticalPhases: 3 };
  const lg = simInputsFromRow(withLg, "nobuild");
  const NB = lg.approaches.NB, SB = lg.approaches.SB;
  ok(NB.splitSource === "laneGroups" && Math.abs(NB.leftShare - 60 / 400) < 1e-9 && Math.abs(NB.rightShare - 40 / 400) < 1e-9,
    `lane groups: NB split from measured volumes (L ${NB.leftShare.toFixed(3)}, R ${NB.rightShare.toFixed(3)})`);
  ok(NB.throughLanes === 2 && NB.lanesSource === "import", "lane groups: NB through lanes from the row (2, import)");
  ok(NB.leftBayFt === 175 && NB.leftBaySource === "laneGroups" && NB.leftBayAssumed === false, `lane groups: NB bay = L storageFt (${NB.leftBayFt} ft)`);
  ok(SB.leftBayFt === 140 && SB.leftBaySource === "existingStorage" && SB.leftBayAssumed === false, `governing storage: SB bay = existingStorageFt when storageMovement is SBL (${SB.leftBayFt} ft)`);
  ok(lg.signal.gNsLeft !== undefined && Math.abs(lg.signal.gNsLeft - gcNsL * C0) < 1e-9 && lg.signal.phases[0].key === "nsL" && lg.signal.slackSec === 0,
    `protected NS left: its own leading phase, ${f1(lg.signal.gNsLeft)} s = gOverCnsLeft × cycle; 3 phases fit the cycle exactly`);
  ok(Math.abs(lg.signal.phases.reduce((s, p) => s + p.greenSec + YELLOW_S + ALL_RED_S, 0) + lg.signal.slackSec - lg.signal.cycleLenSec) < 1e-6,
    "phases + 5 s lost time each + slack = the cycle");
  const sim = new IntersectionSim(lg, 3);
  sim.runCycles(10);
  const m = sim.metrics();
  ok(m.arrivals === m.throughput + m.onNetwork && !hasBadNumber(m) && sim.cars().some((c) => c.approach === "NB" && c.lane === 1),
    "lane-group row simulates: conserved, finite, and the second NB through lane is used");

  // Studio override and the no-timing fallback.
  const ov = simInputsFromRow(row, "build", { signalTiming: { ...row.signalTiming, cycleLenSec: 90, basis: "measured", source: "override" } });
  ok(ov.signal.cycleLenSec === 90 && ov.signal.source === "override" && Math.abs(ov.signal.gNs - row.signalTiming.gOverCnsExact * 90) < 1e-9, "opts.signalTiming replaces the row's timing (cycle 90 s, greens re-derived from g/C)");
  const bare = structuredClone(row); delete bare.signalTiming;
  const fb = simInputsFromRow(bare, "build");
  ok(fb.signal.assumed && fb.signal.basis === "screening-default" && fb.signal.cycleLenSec === 90 && fb.notes.some((n) => /screening default/.test(n)),
    `no signalTiming on the row: screening default, flagged assumed (${fb.signal.cycleLenSec} s, greens ${f1(fb.signal.gNs)}/${f1(fb.signal.gEw)} s after fitting 2 × 5 s lost time)`);
  // No plan but an imported cycle (screening mode + import): the engine computed
  // the row's delay and queue on that cycle (row-math.ts cyc = utdfCycleLenS), so the sim runs it.
  const bareImport = { ...bare, utdfCycleLenSec: 120 };
  const fbi = simInputsFromRow(bareImport, "build");
  ok(fbi.signal.assumed && fbi.signal.cycleLenSec === 120 && Math.abs(fbi.signal.gNs - 0.45 * 120) < 1e-9 && Math.abs(fbi.signal.gEw - 0.45 * 120) < 1e-9 && Math.abs(fbi.signal.slackSec - 2) < 1e-9 && fbi.notes.some((n) => /imported 120 s cycle/.test(n)),
    `no signalTiming but utdfCycleLenSec 120: the sim runs the imported cycle (${fbi.signal.cycleLenSec} s, greens ${f1(fbi.signal.gNs)}/${f1(fbi.signal.gEw)} s = g/C 0.45 × 120, ${f1(fbi.signal.slackSec)} s slack) and says so`);
  // Weather: the factor rides the inputs and sizes the discharge rate.
  const clear = simInputsFromRow(row, "build");
  ok(clear.weatherFactor === 1 && clear.satFlowVphpl === SATURATION_FLOW_VPH && !clear.notes.some((n) => /weather/.test(n)), "no weather option: factor 1, 1800 vphpl, no weather note");
  const wet = simInputsFromRow(row, "build", { weatherFactor: 0.86 });
  ok(wet.weatherFactor === 0.86 && Math.abs(wet.satFlowVphpl - 1548) < 1e-9 && wet.notes.some((n) => /1800 × weather 0\.86 = 1548 vphpl/.test(n)),
    `weatherFactor 0.86: satFlowVphpl ${wet.satFlowVphpl} = 1800 × 0.86, disclosed in notes`);
}

// ---------------------------------------------------------------- (w) weather
console.log("\n(w) weather factor 0.86 — sim discharges at the row's weather-adjusted saturation flow");
{
  const WF = 0.86;
  const clear = run(row, "nobuild");
  const wet = run(row, "nobuild", SEED, CYCLES, { weatherFactor: WF });
  ok(Math.abs(wet.sim.satHeadwayS - 3600 / (SATURATION_FLOW_VPH * WF)) < 1e-9, `stop-line headway ${wet.sim.satHeadwayS.toFixed(3)} s = 3600 / (1800 × ${WF})`);
  let worstRatio = 1, clearSum = 0, wetSum = 0;
  for (const d of DIRECTIONS) {
    const e = engineFor(wet.inputs, d), e0 = engineFor(clear.inputs, d);
    ok(Math.abs(e.cap - e0.cap * WF) < 1e-9 && e.delay > e0.delay, `${d}: weather-adjusted engine capacity ${e.cap.toFixed(1)} = ${e0.cap.toFixed(1)} × ${WF}; engine delay ${f1(e.delay)} s > clear ${f1(e0.delay)} s`);
    const ratio = wet.m.approaches[d].simDelaySec / e.delay;
    if (Math.abs(ratio - 1) > Math.abs(worstRatio - 1)) worstRatio = ratio;
    ok(inBand(ratio), `${d}: sim ${f1(wet.m.approaches[d].simDelaySec)} s vs weather-adjusted engine ${f1(e.delay)} s → ${(ratio * 100).toFixed(0)} % (band ±${BAND * 100} %)`);
    clearSum += clear.m.approaches[d].simDelaySec; wetSum += wet.m.approaches[d].simDelaySec;
  }
  ok(wetSum > clearSum, `mean simulated delay rises with the reduced saturation flow: ${f1(wetSum / 4)} s at ${WF} vs ${f1(clearSum / 4)} s clear`);
  // Like for like the other way: the weather run against the CLEAR engine figure would understate it.
  const under = DIRECTIONS.filter((d) => wet.m.approaches[d].simDelaySec < engineFor(clear.inputs, d).delay * (1 + BAND)).length;
  ok(under === 4, "the weather run does not drift above the clear-weather engine band either (the comparison is only meaningful like for like)");
}

// ---------------------------------------------------------------- (l) lanes
console.log("\n(l) two through lanes — Q95 compared as the approach total, worst lane shown separately");
{
  const two = structuredClone(row);
  for (const a of two.approaches) { a.throughLanes = 2; a.lanesSource = "import"; }
  // Q95 is a 95th percentile over cycles — two samples in thirty — so this
  // section runs the sweep's 60 cycles for a steadier comparison.
  const one = run(row, "nobuild", SEED, 2 * CYCLES);
  const { inputs, m } = run(two, "nobuild", SEED, 2 * CYCLES);
  ok(DIRECTIONS.every((d) => inputs.approaches[d].throughLanes === 2 && inputs.approaches[d].lanesSource === "import"), `sim inputs carry 2 through lanes per approach (${2 * CYCLES} cycles)`);
  for (const d of DIRECTIONS) {
    const e = engineFor(inputs, d), e1 = engineFor(one.inputs, d);
    ok(Math.abs(e.cap - 2 * e1.cap) < 1e-9, `${d}: engine capacity doubles (${e.cap.toFixed(1)} vph), v/c ${e.vc.toFixed(3)}`);
    const a = m.approaches[d];
    const ratio = a.simDelaySec / e.delay;
    ok(inBand(ratio), `${d}: sim delay ${f1(a.simDelaySec)} s vs engine ${f1(e.delay)} s → ${(ratio * 100).toFixed(0)} %`);
    ok(a.q95WorstLaneFt < a.q95Ft && a.q95WorstLaneFt >= a.q95Ft / 2 - 1e-9,
      `${d}: worst lane ${a.q95WorstLaneFt.toFixed(0)} ft sits between total ÷ 2 and the approach total ${a.q95Ft.toFixed(0)} ft`);
    const qRatio = a.q95Ft / e.q95Ft;
    ok(inBand(qRatio), `${d}: approach-total Q95 ${a.q95Ft.toFixed(0)} ft vs engine queue95Ft ${e.q95Ft.toFixed(0)} ft → ${(qRatio * 100).toFixed(0)} % (like for like: both the whole approach's queue in vehicles × 25 ft)`);
  }
  ok(DIRECTIONS.every((d) => one.m.approaches[d].q95WorstLaneFt === one.m.approaches[d].q95Ft), "one-lane row: worst lane and approach total are the same number");
  const q1 = DIRECTIONS.map((d) => one.m.approaches[d].q95Ft / engineFor(one.inputs, d).q95Ft);
  ok(q1.every(inBand), `one-lane row: approach-total Q95 within the band of queue95Ft on every approach (${q1.map((r) => `${(r * 100).toFixed(0)} %`).join(" / ")})`);
}

// ---------------------------------------------------------------- (t) analysis period
console.log("\n(t) the engine's analysis period");
{
  ok(ANALYSIS_PERIOD_S === 0.25 * 3600, `ANALYSIS_PERIOD_S = ${ANALYSIS_PERIOD_S} s = the T = 0.25 h of Akçelik d2`);
  const inputs = simInputsFromRow(row, "nobuild");
  const sim = new IntersectionSim(inputs, SEED);
  sim.step(ANALYSIS_PERIOD_S);
  const m = sim.metrics();
  ok(Math.abs(sim.simT - ANALYSIS_PERIOD_S) < 1e-6 && m.cycles === Math.floor(ANALYSIS_PERIOD_S / inputs.signal.cycleLenSec), `${m.cycles} cycles complete in the ${ANALYSIS_PERIOD_S} s window`);
  const ratios = DIRECTIONS.map((d) => m.approaches[d].simDelaySec / engineFor(inputs, d).delay);
  ok(ratios.every(inBand), `over exactly the analysis period the sim still lands in the band on every approach (${ratios.map((r) => `${(r * 100).toFixed(0)} %`).join(" / ")})`);
}

// ---------------------------------------------------------------- (g) build ≥ no-build
console.log("\n(g) build ≥ no-build on the most-loaded approach");
{
  let best = null;
  for (const r of BASE.affectedIntersections) {
    if (r.signalTiming?.basis !== "webster") continue;
    for (const a of r.approaches) if (!best || a.addedTripsPeak > best.trips) best = { row: r, d: a.direction, trips: a.addedTripsPeak };
  }
  ok(!!best && best.trips > 0, `${best.row.signalId} ${best.d} receives the most project trips (+${best.trips} vph)`);
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  let nbSum = 0, bdSum = 0, arrivalsOk = true, demandOk = true;
  const diffs = [];
  for (const seed of seeds) {
    const nb = run(best.row, "nobuild", seed), bd = run(best.row, "build", seed);
    demandOk &&= bd.inputs.approaches[best.d].vph > nb.inputs.approaches[best.d].vph;
    arrivalsOk &&= bd.m.approaches[best.d].arrivals >= nb.m.approaches[best.d].arrivals;
    nbSum += nb.m.approaches[best.d].simDelaySec; bdSum += bd.m.approaches[best.d].simDelaySec;
    diffs.push(bd.m.approaches[best.d].simDelaySec - nb.m.approaches[best.d].simDelaySec);
  }
  const a = best.row.approaches.find((x) => x.direction === best.d);
  ok(demandOk, `build demand ${f1(a.futureVolumeVph)} vph > no-build ${f1(a.existingVolumeVph)} vph`);
  ok(arrivalsOk, `build arrivals ≥ no-build arrivals on every seed (shared background stream)`);
  ok(bdSum >= nbSum,
    `mean over ${seeds.length} seeds: build delay ${f1(bdSum / seeds.length)} s ≥ no-build ${f1(nbSum / seeds.length)} s (engine: ${a.futureDelaySec} vs ${a.existingDelaySec} s; per-seed Δ ${diffs.map((x) => (x >= 0 ? "+" : "") + x.toFixed(2)).join(" ")})`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-sim passed");
process.exit(failed ? 1 : 0);
