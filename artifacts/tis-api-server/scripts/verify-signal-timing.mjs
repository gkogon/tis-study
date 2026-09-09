// Signal-timing resolver: tier precedence, protected-left phasing, pedestrian
// minimum green, Synchro phase→movement→split mapping, provider ordering, and
// property floors. Module-level; the engine-level assertions (timing held
// fixed across scenarios, capacity re-derived, legacy flag byte-identical,
// provenance surviving codegen) live in verify-signal-timing-engine.mjs.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/webster-timing.ts"));
const {
  computeSignalTiming, resolveSignalTiming, timingFromSynchroPhases, gOverCForMovement,
  inferLeftPhasing, pedestrianMinGreenS,
  MIN_CYCLE_S, MAX_CYCLE_S, MIN_PHASE_GREEN_S, LOST_TIME_PER_PHASE_S, MAX_CRITICAL_FLOW_RATIO,
  LEFT_CROSS_PRODUCT_THRESHOLDS,
} = m;
const { CYCLE_LEN, G_OVER_C, SATURATION_FLOW_VPH } = await import(path.resolve(here, "../src/lib/signal-delay.ts"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const webster = (Y, nPhases) => Math.min(MAX_CYCLE_S, Math.max(MIN_CYCLE_S, Math.ceil(((1.5 * LOST_TIME_PER_PHASE_S * nPhases + 5) / (1 - Y)) / 5) * 5));

// --- 1. two-phase behaviour is reproduced when lefts are forced permissive ---
{
  const perm = { ns: "permissive", ew: "permissive" };
  const quiet = computeSignalTiming({ approachVph: { NB: 100, SB: 100, EB: 100, WB: 100 }, leftPhasing: perm });
  ok(quiet.basis === "webster" && quiet.cycleLenS === MIN_CYCLE_S && quiet.criticalPhases === 2,
     `quiet two-phase intersection lands on the ${MIN_CYCLE_S} s floor (got ${quiet.cycleLenS} s, ${quiet.criticalPhases} phases)`);
  const Y = (800 + 600) / SATURATION_FLOW_VPH;
  const busy = computeSignalTiming({ approachVph: { NB: 800, SB: 700, EB: 600, WB: 500 }, leftPhasing: perm });
  ok(busy.cycleLenS === webster(Y, 2), `busy two-phase: Webster C=(1.5L+5)/(1-Y) rounded up to 5 s → ${webster(Y, 2)} s (got ${busy.cycleLenS})`);
  ok(busy.gOverCns > busy.gOverCew, `the heavier axis gets the longer green (ns ${busy.gOverCns} > ew ${busy.gOverCew})`);
  const sat = computeSignalTiming({ approachVph: { NB: 900, SB: 900, EB: 800, WB: 800 }, leftPhasing: perm });
  ok(sat.basis === "screening-default" && sat.cycleLenS === CYCLE_LEN && near(sat.gOverCns, G_OVER_C),
     `Y ≥ ${MAX_CRITICAL_FLOW_RATIO} → screening default, not an absurd cycle (basis ${sat.basis})`);
  const none = computeSignalTiming({ approachVph: {} });
  ok(none.basis === "screening-default" && none.cycleLenS === CYCLE_LEN, "no volumes → screening default 90 s / 0.45");
}

// --- 2. protected-left inference (FHWA-HRT-04-091 cross-product guidance) ---
{
  ok(LEFT_CROSS_PRODUCT_THRESHOLDS[1] === 50000 && LEFT_CROSS_PRODUCT_THRESHOLDS[2] === 90000 && LEFT_CROSS_PRODUCT_THRESHOLDS[3] === 110000,
     "cross-product thresholds are the published 50,000 / 90,000 / 110,000 by opposing through lanes");
  // 10% lefts by convention: NB left 100 × SB opposing through 800 = 80,000 ≥ 50,000 (one opposing lane)
  const p1 = inferLeftPhasing({ approachVph: { NB: 1000, SB: 1000, EB: 300, WB: 300 } });
  ok(p1.ns === "protected" && p1.ew === "permissive", `1,000 vph axis infers a protected left, 300 vph axis stays permissive (${p1.ns}/${p1.ew})`);
  const p2 = inferLeftPhasing({ approachVph: { NB: 1000, SB: 1000, EB: 300, WB: 300 }, opposingLanes: { ns: 2, ew: 1 } });
  ok(p2.ns === "permissive", "two opposing lanes raise the threshold to 90,000 → same volumes stay permissive");
  const p3 = inferLeftPhasing({ approachVph: { NB: 1000, SB: 1000 }, leftVph: { NB: 20, SB: 20 } });
  ok(p3.ns === "permissive", "a measured 20 vph left does not warrant protection even on a 1,000 vph approach");
  const explicit = computeSignalTiming({ approachVph: { NB: 1000, SB: 1000, EB: 300, WB: 300 }, leftPhasing: { ns: "permissive", ew: "protected" } });
  ok(explicit.leftPhasing.ns === "permissive" && explicit.leftPhasing.ew === "protected", "an explicit (imported) phasing overrides the inference");
}

// --- 3. critical phases drive lost time: published numerators 20 / 27.5 / 35 ---
{
  const Y = 0.5;
  const cyc = (n) => (1.5 * LOST_TIME_PER_PHASE_S * n + 5) / (1 - Y);
  ok(near(cyc(2), 20 / 0.5) && near(cyc(3), 27.5 / 0.5) && near(cyc(4), 35 / 0.5), "numerators 1.5L+5 = 20 / 27.5 / 35 for 2 / 3 / 4 critical phases");
  const two = computeSignalTiming({ approachVph: { NB: 450, SB: 450, EB: 450, WB: 450 }, leftPhasing: { ns: "permissive", ew: "permissive" } });
  const four = computeSignalTiming({ approachVph: { NB: 450, SB: 450, EB: 450, WB: 450 }, leftVph: { NB: 150, SB: 150, EB: 150, WB: 150 }, leftPhasing: { ns: "protected", ew: "protected" } });
  ok(two.criticalPhases === 2 && four.criticalPhases === 4, `phase count follows protection (${two.criticalPhases} vs ${four.criticalPhases})`);
  ok(four.cycleLenS >= two.cycleLenS, `more lost time never shortens the cycle (${two.cycleLenS} s → ${four.cycleLenS} s)`);
}

// --- 4. splits: sum to the available green, lefts shorter than throughs ---
{
  const t = computeSignalTiming({ approachVph: { NB: 800, SB: 700, EB: 500, WB: 400 }, leftVph: { NB: 150, SB: 120, EB: 60, WB: 60 }, leftPhasing: { ns: "protected", ew: "permissive" } });
  ok(t.criticalPhases === 3 && typeof t.gOverCnsLeft === "number" && t.gOverCewLeft === undefined, "3-phase: NS gets a left phase, EW left rides the through phase");
  const sumG = (t.gOverCns + t.gOverCew + (t.gOverCnsLeft ?? 0)) * t.cycleLenS;
  ok(near(sumG, t.cycleLenS - LOST_TIME_PER_PHASE_S * 3, 0.5), `phase greens sum to cycle − lost time (${sumG.toFixed(1)} vs ${t.cycleLenS - 15})`);
  ok(t.gOverCnsLeft < t.gOverCns, `protected left gets less green than its through (${t.gOverCnsLeft} < ${t.gOverCns})`);
  ok(gOverCForMovement(t, "NB", "L") === t.gOverCnsLeft && gOverCForMovement(t, "NB", "T") === t.gOverCns && gOverCForMovement(t, "EB", "L") === t.gOverCew,
     "gOverCForMovement: protected L → left phase; T/R and permissive L → through phase");
}

// --- 5. pedestrian minimum green: 7 s walk + width / 3.5 ft/s ---
{
  ok(near(pedestrianMinGreenS(2), 7 + 24 / 3.5, 0.01) && near(pedestrianMinGreenS(6), 7 + 72 / 3.5, 0.01), "ped min = 7 + 12 ft × lanes / 3.5 ft/s");
  const wide = computeSignalTiming({ approachVph: { NB: 20, SB: 20, EB: 900, WB: 900 }, crossingLanes: { ns: 6, ew: 2 }, leftPhasing: { ns: "permissive", ew: "permissive" } });
  ok(wide.gOverCns * wide.cycleLenS >= pedestrianMinGreenS(6) - 0.5, `a near-empty NS phase still serves peds crossing a six-lane EW street (${(wide.gOverCns * wide.cycleLenS).toFixed(1)} s ≥ ${pedestrianMinGreenS(6).toFixed(1)} s)`);
  const dflt = computeSignalTiming({ approachVph: { NB: 20, SB: 20, EB: 900, WB: 900 }, leftPhasing: { ns: "permissive", ew: "permissive" } });
  ok(dflt.gOverCns * dflt.cycleLenS >= pedestrianMinGreenS(2) - 0.5 && dflt.gOverCns * dflt.cycleLenS >= MIN_PHASE_GREEN_S,
     `default crossing (one lane per direction) floors the phase at ${pedestrianMinGreenS(2).toFixed(1)} s, above the ${MIN_PHASE_GREEN_S} s vehicle minimum`);
}

// --- 6. measured tier from Synchro phases + splits; graceful degrade ---
{
  const phaseByMovement = { NBL: 5, NBT: 2, NBR: 2, SBL: 1, SBT: 6, SBR: 6, EBL: 3, EBT: 8, EBR: 8, WBL: 7, WBT: 4, WBR: 4 };
  const splitSByPhase = { 1: 15, 2: 40, 3: 12, 4: 30, 5: 15, 6: 40, 7: 12, 8: 30 };
  const full = timingFromSynchroPhases({ cycleLenSec: 100, phaseByMovement, splitSByPhase });
  ok(full && full.basis === "measured" && full.cycleLenS === 100, `full phase map + splits → measured (basis ${full?.basis})`);
  ok(full && near(full.gOverCns, (40 - LOST_TIME_PER_PHASE_S) / 100, 0.011) && near(full.gOverCnsLeft, (15 - LOST_TIME_PER_PHASE_S) / 100, 0.011),
     `measured g/C = (split − lost time) / cycle: ns through ${full?.gOverCns}, ns left ${full?.gOverCnsLeft}`);
  ok(full && full.leftPhasing.ns === "protected" && full.leftPhasing.ew === "protected" && full.criticalPhases === 4, "lefts on their own phases → protected, 4 critical phases");
  const perm = timingFromSynchroPhases({ cycleLenSec: 100, phaseByMovement: { ...phaseByMovement, NBL: 2, SBL: 6 }, splitSByPhase });
  ok(perm && perm.leftPhasing.ns === "permissive" && perm.gOverCnsLeft === undefined, "a left sharing its through phase → permissive on that axis");
  const cycleOnly = timingFromSynchroPhases({ cycleLenSec: 100 });
  ok(cycleOnly === undefined, "cycle only → resolver must fall through to measured-cycle (Webster splits), not fabricate splits");
  const noMap = timingFromSynchroPhases({ cycleLenSec: 100, splitSByPhase });
  ok(noMap === undefined, "splits without a Phase1 movement map → undefined (no NEMA guessing), degrade to measured-cycle");
  const mc = computeSignalTiming({ approachVph: { NB: 800, SB: 700, EB: 500, WB: 400 }, measuredCycleS: 100 });
  ok(mc.basis === "measured-cycle" && mc.cycleLenS === 100, `measured cycle + computed splits → basis measured-cycle (${mc.basis}, ${mc.cycleLenS} s)`);
}

// --- 7. provider ordering: first resolving provider wins; removal falls through ---
{
  const utdf = () => timingFromSynchroPhases({ cycleLenSec: 110, phaseByMovement: { NBT: 2, SBT: 6, EBT: 4, WBT: 8, NBL: 2, SBL: 6, EBL: 4, WBL: 8 }, splitSByPhase: { 2: 55, 6: 55, 4: 45, 8: 45 } });
  const agency = () => ({ ...computeSignalTiming({ approachVph: { NB: 500, SB: 500, EB: 500, WB: 500 }, measuredCycleS: 130 }), basis: "measured", source: "stub agency sheet 2021-10-04" });
  const fallback = { approachVph: { NB: 500, SB: 500, EB: 500, WB: 500 } };
  const a = resolveSignalTiming({ providers: [utdf, agency], fallback });
  ok(a.cycleLenS === 110 && a.basis === "measured" && a.source === "synchro", `client Synchro upload outranks the agency sheet (${a.cycleLenS} s, ${a.source})`);
  const b = resolveSignalTiming({ providers: [() => undefined, agency], fallback });
  ok(b.cycleLenS === 130 && /agency/.test(b.source ?? ""), `with the upload gone the agency provider resolves (${b.cycleLenS} s)`);
  const c = resolveSignalTiming({ providers: [() => undefined], fallback });
  ok(c.basis === "webster", `no provider resolves → Webster from volumes (${c.basis})`);
  const d = resolveSignalTiming({ providers: [], fallback: { approachVph: {} } });
  ok(d.basis === "screening-default", "no providers, no volumes → screening default");
}

// --- 8. property floors over 3,000 random intersections ---
{
  let seed = 20260908; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let bad = 0, n = 3000;
  for (let i = 0; i < n; i++) {
    const v = () => (rnd() < 0.15 ? 0 : Math.round(rnd() * 1500));
    const t = computeSignalTiming({
      approachVph: { NB: v(), SB: v(), EB: v(), WB: v() },
      ...(rnd() < 0.5 ? { leftVph: { NB: v() / 5, SB: v() / 5, EB: v() / 5, WB: v() / 5 } } : {}),
      ...(rnd() < 0.5 ? { crossingLanes: { ns: 1 + Math.floor(rnd() * 8), ew: 1 + Math.floor(rnd() * 8) } } : {}),
      ...(rnd() < 0.3 ? { measuredCycleS: 30 + Math.round(rnd() * 270) } : {}),
    });
    const gs = [t.gOverCns, t.gOverCew, t.gOverCnsLeft, t.gOverCewLeft].filter((x) => x !== undefined);
    const okRow = Number.isFinite(t.cycleLenS) && t.cycleLenS >= 30 && t.cycleLenS <= 300
      && gs.every((g) => Number.isFinite(g) && g > 0 && g <= 1)
      && gs.reduce((s, g) => s + g, 0) <= 1 + 1e-9
      && gs.every((g) => g * t.cycleLenS >= MIN_PHASE_GREEN_S - 1e-6 || t.basis === "screening-default");
    if (!okRow) { bad++; if (bad <= 3) console.log("   counterexample:", JSON.stringify(t)); }
  }
  ok(bad === 0, `every g/C finite, in (0, 1], Σ ≤ 1, every phase ≥ ${MIN_PHASE_GREEN_S} s, cycle in [30, 300] over ${n} random intersections (${bad} violations)`);
}


// --- 9. mitigation-trigger regression grid (the 2026-08-31 claim, re-run under fixed timing) ---
// 121 intersections (NS, EW critical volumes 100–1000 vph) × 4 approaches ×
// +5/+10/+20% project load. A "trigger" is an approach moving from ≤ D to ≥ E
// when the project load is added. Timing is resolved ONCE from the no-build
// volumes and held fixed while the load is added (the §4.2 rule).
//
// FINDING (2026-09-08). The 2026-08-31 analysis reported that the flat
// 90 s / 0.45 model never MISSES a trigger the resolved model fires, and that
// claim was the basis for calling the flat model "conservative". Under fixed
// timing it does not hold, in either variant: a 0.45 green ratio for EVERY
// approach is a signal that gives conflicting phases 90% of the cycle between
// them, which no controller does — so a minor street at a busy major, which a
// real (or Webster) plan gives 15–25% of the cycle, sits far closer to
// capacity than the flat model charges it. Those are triggers the flat model
// under-predicted. What IS invariant, and asserted here: every disagreement
// has one of two explanations and no third. Either the resolved plan treats
// the approach differently on a timing lever (Webster d1 rises with cycle
// length and falls with g/C — a flat-missed trigger sits on an approach the
// plan treats WORSE, g/C < 0.45 or cycle > 90 s; a false alarm on one it
// treats BETTER), or the "missing" model had ALREADY failed the approach
// before the project (LOS ≥ E pre-project cannot "trigger" by definition,
// so the flat model had flagged it earlier, not missed it). Never an
// arithmetic defect.
{
  const { vcToDelay, delayToLos, APPROACH_CAPACITY_VPH } = await import(path.resolve(here, "../src/lib/signal-delay.ts"));
  const rank = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };
  const run = (variant) => {
    let agree = 0, flatMissed = 0, flatFalse = 0, n = 0, guard = 0, missedAbove = 0, falseBelow = 0;
    for (let ns = 100; ns <= 1000; ns += 90) for (let ew = 100; ew <= 1000; ew += 90) {
      const approachVph = { NB: ns, SB: ns, EB: ew, WB: ew };
      const t = computeSignalTiming({ approachVph, ...(variant === "two-phase" ? { inferLeftPhasing: false } : {}) });
      if (t.basis === "screening-default") { guard++; continue; }
      for (const d of ["NB", "SB", "EB", "WB"]) {
        const v = approachVph[d];
        const gc = gOverCForMovement(t, d, "T"), capW = SATURATION_FLOW_VPH * gc;
        for (const g of [0.05, 0.10, 0.20]) {
          n++;
          const flatBefore = rank[delayToLos(vcToDelay(v / APPROACH_CAPACITY_VPH, APPROACH_CAPACITY_VPH))];
          const flatAfter = rank[delayToLos(vcToDelay((v * (1 + g)) / APPROACH_CAPACITY_VPH, APPROACH_CAPACITY_VPH))];
          const wBefore = rank[delayToLos(vcToDelay(v / capW, capW, t.cycleLenS, gc))];
          const wAfter = rank[delayToLos(vcToDelay((v * (1 + g)) / capW, capW, t.cycleLenS, gc))];
          const flatTrig = flatBefore <= 4 && flatAfter >= 5, wTrig = wBefore <= 4 && wAfter >= 5;
          if (flatTrig === wTrig) agree++;
          else if (wTrig && !flatTrig) { flatMissed++; if (gc >= G_OVER_C && t.cycleLenS <= CYCLE_LEN && flatBefore <= 4) missedAbove++; }
          else { flatFalse++; if (gc <= G_OVER_C && t.cycleLenS >= CYCLE_LEN && wBefore <= 4) falseBelow++; }
        }
      }
    }
    return { agree, flatMissed, flatFalse, n, guard, missedAbove, falseBelow };
  };
  const two = run("two-phase"), full = run("full");
  for (const [label, r] of [["two-phase", two], ["full     ", full]]) {
    console.log(`   ${label} grid: ${r.n} approach-scenarios (${r.guard} intersections on the saturation guard) — agree ${r.agree} (${(100 * r.agree / r.n).toFixed(1)}%), flat MISSED ${r.flatMissed}, flat false-alarmed ${r.flatFalse}`);
  }
  ok(two.flatMissed > 0 && full.flatMissed > 0,
     `the 2026-08-31 "flat never misses a trigger" claim does NOT survive fixed timing (two-phase missed ${two.flatMissed}, full missed ${full.flatMissed}) — recorded, not hidden`);
  ok(two.missedAbove === 0 && full.missedAbove === 0, `every flat-missed trigger is on an approach the resolved plan treats worse on a lever (g/C < ${G_OVER_C} or cycle > ${CYCLE_LEN} s) or that the flat model had already failed pre-project — ${two.missedAbove + full.missedAbove} unexplained`);
  ok(two.falseBelow === 0 && full.falseBelow === 0, `every flat false alarm is on an approach the resolved plan treats better on a lever (g/C > ${G_OVER_C} or cycle < ${CYCLE_LEN} s) or that it had already failed pre-project — ${two.falseBelow + full.falseBelow} unexplained`);
}

console.log(fails === 0 ? "\nsignal timing OK" : `\n${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
