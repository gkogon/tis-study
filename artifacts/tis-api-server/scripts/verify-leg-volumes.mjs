// Leg volumes + movement estimation (lib/tis-engine-core/src/leg-volumes.ts).
// Pins: leg → approach assignment, per-leg resolution (main road / class
// default / one-way), IPF balancing invariants, and — via row-math — that
// legVolumes:"screening" and an absent estimate are byte-identical to the
// pre-change row. Spec: docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md
//
// Run: node ./scripts/verify-leg-volumes.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const core = await import("@workspace/tis-engine-core");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const DIRS = ["NB", "SB", "EB", "WB"];

// ---- 1. leg → approach assignment (spec §4.2 step 1, §9 item 9) ----
{
  const legs = [
    { bearingDeg: 2, cls: 2, oneWay: null },    // far end north  → SB approach
    { bearingDeg: 91, cls: 3, oneWay: null },   // far end east   → WB approach
    { bearingDeg: 181, cls: 2, oneWay: null },  // far end south  → NB approach
    { bearingDeg: 268, cls: 3, oneWay: null },  // far end west   → EB approach
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(byDir.SB?.bearingDeg === 2 && byDir.WB?.bearingDeg === 91 && byDir.NB?.bearingDeg === 181 && byDir.EB?.bearingDeg === 268,
    "assign: N/E/S/W far ends map to SB/WB/NB/EB approaches");
  ok(dropped === 0, "assign: four distinct legs, none dropped");
}
{
  // Five-leg: two legs quantize to EB; keep the higher class (lower cls), drop the other (§9 item 8).
  const legs = [
    { bearingDeg: 0, cls: 2, oneWay: null }, { bearingDeg: 90, cls: 2, oneWay: null },
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 260, cls: 4, oneWay: null }, { bearingDeg: 280, cls: 2, oneWay: null },
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(dropped === 1 && byDir.EB?.cls === 2 && byDir.EB?.bearingDeg === 280, "assign: five-leg keeps the higher-class EB leg, dropped = 1");
}
{
  const { byDir } = core.assignLegsToApproaches([{ bearingDeg: 44, cls: 3, oneWay: null }, { bearingDeg: 46, cls: 3, oneWay: null }]);
  ok(byDir.SB !== undefined && byDir.WB !== undefined, "assign: 44° → SB (north), 46° → WB (east) — nearest-cardinal quantization");
}
{
  ok(core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[4] === 700 && core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[0] === 2500,
    "ladder mirrors the analyzer's VOLUME_BY_CLASS (tertiary 700 … motorway 2500)");
}
{
  // EXIT_LEG follows the spec rule: through at β+180°, left at β+90°, right at β−90°,
  // where β is the approach's origin bearing and the exit is the approach whose origin leg sits there.
  const legAt = (bearing) => DIRS.find((d) => core.ORIGIN_BEARING[d] === ((bearing % 360) + 360) % 360);
  const rule = DIRS.every((d) => {
    const b = core.ORIGIN_BEARING[d];
    return core.EXIT_LEG[d].T === legAt(b + 180) && core.EXIT_LEG[d].L === legAt(b + 90) && core.EXIT_LEG[d].R === legAt(b - 90);
  });
  ok(rule, "EXIT_LEG: every row follows through=β+180°, left=β+90°, right=β−90°");
  ok(core.EXIT_LEG.EB.L === "SB" && core.EXIT_LEG.WB.L === "NB", "EXIT_LEG: eastbound left exits north (SB's leg), westbound left exits south (NB's leg)");
}

// ---- 2. per-leg resolution (spec §4.2 steps 2–4, amended: per-signal data) ----
{
  // Four-leg: NB/SB on a primary (cls 2), EB/WB on a tertiary (cls 4). Design hour 2700.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt", "resolve: the two highest-class legs are the main road");
  ok(close(legs.NB.enteringVph, 1350) && close(legs.NB.exitingVph, 1350) && close(legs.SB.enteringVph, 1350), "resolve: main road = design hour / 2 each way, each leg");
  ok(legs.EB.source === "class_default" && close(legs.EB.enteringVph, 350) && close(legs.EB.exitingVph, 350), "resolve: tertiary minor leg = 700 two-way baseline / 2");
  ok(DIRS.every((d) => legs[d].cls === byDir[d].cls), "resolve: each leg carries its class");
}
{
  // Tie on class among three legs: the most opposite pair is the main road.
  const byDir = {
    NB: { bearingDeg: 180, cls: 3, oneWay: null }, SB: { bearingDeg: 0, cls: 3, oneWay: null },
    EB: { bearingDeg: 270, cls: 3, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1000 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt" && legs.EB.source === "class_default",
    "resolve: class tie breaks toward the opposite pair (NB/SB), not the third leg");
}
{
  // T-intersection: no WB leg.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2000 });
  ok(legs.WB === null, "resolve: absent leg is null");
  ok(legs.EB.source === "class_default", "resolve: T stem is the minor leg");
}
{
  // One-way main road: SB leg carries traffic INTO the node only, NB leg OUT only.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: "out" }, SB: { bearingDeg: 0, cls: 2, oneWay: "in" },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1800 });
  ok(close(legs.SB.enteringVph, 1800) && legs.SB.exitingVph === 0, "resolve: one-way-in main leg takes the whole design hour entering, 0 exiting");
  ok(legs.NB.enteringVph === 0 && close(legs.NB.exitingVph, 1800), "resolve: one-way-out main leg takes it all exiting, 0 entering");
}
{
  // CSV override wins on its leg; other legs unchanged.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520, exitingVph: 480 } } });
  ok(legs.EB.source === "csv" && legs.EB.enteringVph === 520 && legs.EB.exitingVph === 480, "resolve: csv leg overrides the class default");
  ok(legs.WB.source === "class_default" && close(legs.WB.enteringVph, 350), "resolve: csv on one leg leaves the others alone");
  const half = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520 } } });
  ok(half.EB.source === "csv" && half.EB.enteringVph === 520 && half.EB.exitingVph === null, "resolve: csv entering-only leaves exiting unknown (null), never invented");
}
{
  const legs = core.resolveLegVolumes({ NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null } }, { signalDesignHourVph: 0 });
  ok(legs.NB.enteringVph === 0 && legs.NB.exitingVph === 0 && !Number.isNaN(legs.NB.enteringVph), "resolve: zero design hour → zero, never NaN");
}
{
  // One clearly-best leg (NB trunk, cls 1) among three same-class minors: its partner is the
  // opposite leg (SB), not a same-class side leg — the single-best-leg branch of mainRoadLegs.
  const byDir = {
    NB: { bearingDeg: 180, cls: 1, oneWay: null }, SB: { bearingDeg: 0, cls: 3, oneWay: null },
    EB: { bearingDeg: 270, cls: 3, oneWay: null }, WB: { bearingDeg: 90, cls: 3, oneWay: null },
  };
  const main = core.mainRoadLegs(byDir);
  ok(main.length === 2 && main.includes("NB") && main.includes("SB"), "resolve: a single best-class leg pairs with the leg opposite it");
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2000 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt" && legs.EB.source === "class_default" && legs.WB.source === "class_default",
    "resolve: main road = the best leg + its opposite; the side legs stay class_default");
}
{
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const exitOnly = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { exitingVph: 480 } } });
  ok(exitOnly.EB.enteringVph === 350 && exitOnly.EB.exitingVph === 480 && exitOnly.EB.source === "class_default",
    "resolve: csv exit-only count keeps the entering side on the baseline (never 0) and labels the entering source");
}

// ---- 3. movement estimation (spec §4.3, §9 items 1–7) ----
const legsFrom = (spec) => {
  const out = { NB: null, SB: null, EB: null, WB: null };
  for (const d of DIRS) {
    const s = spec[d]; if (!s) continue;
    out[d] = { dir: d, enteringVph: s.in, exitingVph: s.out === undefined ? null : s.out, oneWay: s.oneWay ?? null, source: "signal_aadt", cls: 2 };
  }
  return out;
};
const rowSum = (m, d) => DIRS.reduce((s, t) => s + m[d][t], 0);
const colSum = (m, t) => DIRS.reduce((s, d) => s + m[d][t], 0);
{
  // 1. Reference four-leg: entering (600, 400, 300, 200) exiting (550, 450, 280, 220). Σ both = 1500.
  //    Seed 15/70/15 → IPF with the exact row-then-column order and the final
  //    row pass of the implementation. Reference values from an independent
  //    Python run of the same algorithm (13 iterations, final residual 0.318):
  //      NB→SB 398.9  NB→EB 130.6  NB→WB  70.5   | 600.0
  //      SB→NB 353.4  SB→EB  30.2  SB→WB  16.3   | 400.0
  //      EB→NB 132.3  EB→SB  34.6  EB→WB 133.1   | 300.0
  //      WB→NB  64.0  WB→SB  16.7  WB→EB 119.3   | 200.0
  //      cols  549.7        450.3        280.1        220.0
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 550 }, SB: { in: 400, out: 450 }, EB: { in: 300, out: 280 }, WB: { in: 200, out: 220 } }));
  ok(est.diagnostics.method === "ipf" && est.diagnostics.constrainedExits === 4, "ipf: four constrained exit columns");
  ok(DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d])), "ipf: every row sums to its entering volume ±0.5");
  ok(DIRS.every((t) => close(colSum(est.matrix, t), { NB: 550, SB: 450, EB: 280, WB: 220 }[t])), "ipf: every column sums to its exiting volume ±0.5");
  ok(DIRS.every((d) => est.matrix[d][d] === 0), "ipf: diagonal (U-turn) is 0");
  ok(close(est.matrix.NB.SB, 398.9, 0.3) && close(est.matrix.SB.NB, 353.4, 0.3) && close(est.matrix.EB.WB, 133.1, 0.3) && close(est.matrix.WB.EB, 119.3, 0.3),
    "ipf: reproduces the reference through cells within 0.3 vph");
  ok(close(est.matrix.NB.EB, 130.6, 0.3) && close(est.matrix.SB.WB, 16.3, 0.3), "ipf: reproduces the reference turn cells within 0.3 vph");
  ok(est.diagnostics.iterations === 13 && close(est.diagnostics.maxResidualVph, 0.318, 0.01), "ipf: 13 iterations, final residual 0.318 — the exact reference trajectory");
  ok(est.diagnostics.maxResidualVph <= 0.5 && est.diagnostics.iterations <= 50, "ipf: converged within tolerance and the iteration cap");
  ok(DIRS.every((d) => close(est.shares[d].L + est.shares[d].T + est.shares[d].R, 1, 1e-9)), "ipf: shares sum to 1 per approach");
  ok(close(est.leftVph.NB, est.matrix.NB.EB, 1e-9), "ipf: NB left exits through the EB approach's leg (west), β+90°");
  ok(close(est.totalEnteringVph, 1500, 1e-9) && close(est.enteringShares.NB, 0.4, 1e-9), "ipf: total and entering shares");
}
{
  // 2. T-intersection: no WB leg. NB/SB through road, EB stem.
  const est = core.estimateMovements(legsFrom({ NB: { in: 500, out: 480 }, SB: { in: 450, out: 470 }, EB: { in: 200, out: 200 } }));
  ok(est.matrix.EB.WB === 0 && est.matrix.EB.SB > 0 && est.matrix.EB.NB > 0, "T: stem row has no through, only L and R");
  ok(DIRS.every((d) => est.matrix[d].WB === 0) && DIRS.every((t) => est.matrix.WB[t] === 0), "T: absent leg's row and column are all-zero");
  ok(close(est.shares.EB.T, 0, 1e-9) && close(est.shares.EB.L + est.shares.EB.R, 1, 1e-9), "T: stem shares are L+R = 1");
  ok(close(rowSum(est.matrix, "NB"), 500) && close(colSum(est.matrix, "EB"), 200), "T: rows and constrained columns balance");
}
{
  // 3. One-way main road: the SB leg only enters (in 600, out 0), the NB leg only exits (in 0, out 600) —
  //    exactly what resolveLegVolumes produces for a one-way pair. Reference: 6 iterations, residual 0.140.
  const est = core.estimateMovements(legsFrom({ NB: { in: 0, out: 600, oneWay: "out" }, SB: { in: 600, out: 0, oneWay: "in" }, EB: { in: 200, out: 250 }, WB: { in: 250, out: 200 } }));
  ok(DIRS.every((d) => est.matrix[d].SB === 0), "one-way: nothing exits through a one-way-in leg");
  ok(close(rowSum(est.matrix, "SB"), 600) && rowSum(est.matrix, "NB") === 0, "one-way: one-way-out leg has an empty row, one-way-in row balances");
  ok(close(colSum(est.matrix, "NB"), 600), "one-way: everything exiting north goes through the one-way-out leg");
}
{
  // 4. Missing exits on two legs: those columns unconstrained; constrained ones hit target; rows exact.
  //    Reference: 17 iterations; the final row pass leaves the constrained columns at 549.5 / 449.9.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 550 }, SB: { in: 400, out: 450 }, EB: { in: 300 }, WB: { in: 200 } }));
  ok(est.diagnostics.constrainedExits === 2, "missing exits: two constrained columns");
  ok(close(colSum(est.matrix, "NB"), 550, 1.0) && close(colSum(est.matrix, "SB"), 450, 1.0), "missing exits: constrained columns within 1 vph of target after the final row pass");
  ok(DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d], 1e-6)), "missing exits: rows exact (the final pass lands on entering)");
}
{
  // 5. Imbalance > 5%: exits (1800) vs entering (1500) → normalized to 1500, flagged; rows exact.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 660 }, SB: { in: 400, out: 540 }, EB: { in: 300, out: 336 }, WB: { in: 200, out: 264 } }));
  ok(est.diagnostics.exitsNormalized === true && close(est.diagnostics.imbalancePct, 0.2, 1e-6), "imbalance: exits normalized, 20% recorded");
  ok(close(colSum(est.matrix, "NB"), 550) && DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d])), "imbalance: columns scaled to entering, rows exact");
}
{
  // 6. Pathological: exits concentrated on a leg the seed barely feeds. Terminates, finite, no NaN.
  const est = core.estimateMovements(legsFrom({ NB: { in: 1000, out: 10 }, SB: { in: 10, out: 10 }, EB: { in: 10, out: 1000 }, WB: { in: 10, out: 10 } }));
  ok(est.diagnostics.iterations <= 50 && Number.isFinite(est.diagnostics.maxResidualVph), "pathological: terminates at the cap with a finite residual");
  ok(DIRS.every((d) => DIRS.every((t) => Number.isFinite(est.matrix[d][t]))), "pathological: no NaN anywhere in the matrix");
}
{
  // 7. No exit volumes at all → seed only: 15/70/15 on a four-leg.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600 }, SB: { in: 400 }, EB: { in: 300 }, WB: { in: 200 } }));
  ok(est.diagnostics.method === "seed_only" && close(est.shares.NB.T, 0.70, 1e-9) && close(est.shares.NB.L, 0.15, 1e-9), "seed_only: no constraints → 15/70/15 prior");
}
{
  // Zero-entering approach keeps finite default shares so downstream never divides by zero.
  const est = core.estimateMovements(legsFrom({ NB: { in: 0, out: 100 }, SB: { in: 300, out: 100 }, EB: { in: 100, out: 100 }, WB: { in: 100, out: 200 } }));
  ok(close(est.shares.NB.L + est.shares.NB.T + est.shares.NB.R, 1, 1e-9) && est.leftVph.NB === 0, "zero entering: shares finite (seed), left 0");
}

// ---- 4. row-math consumption: screening/absent byte-identical; network uses the estimate; measured wins ----
{
  // 1200 vph design hour (not the McKnight-scale 2700): with one lane per
  // direction the leg volumes must keep the critical flow ratio under the
  // Webster saturation guard (Y ≥ 0.85 → basis "screening-default"), or the
  // timing assertion below would be testing the guard, not the estimate.
  const sig = { id: "sig-1", name: "Main St & Oak Ave", zone: "Z", latitude: 40.5, longitude: -80.0, totalVolume: 1200 };
  const project = { lat: 40.51, lon: -80.01 };
  // distributionOctants so project trips get per-movement rows — without it the
  // lane-group allocator has no movement basis and (correctly) prints none.
  const octants = { NNE: 12.5, ENE: 12.5, ESE: 12.5, SSE: 12.5, SSW: 12.5, WSW: 12.5, WNW: 12.5, NNW: 12.5 };
  const base = { growthMultiplier: 1.05, capacityVph: 3240, approachCapacityVph: 810, externalTrips: 120, inFraction: 0.6, signalTiming: "computed", weatherFactor: 1, distributionOctants: octants };
  const junction = [
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 0, cls: 2, oneWay: null },
    { bearingDeg: 270, cls: 4, oneWay: null }, { bearingDeg: 90, cls: 4, oneWay: null },
  ];
  const estimate = core.buildLegEstimate(junction, { signalDesignHourVph: 1200 });
  const cand = (extra) => ({ sig, distanceMi: 0.4, ...extra });

  const legacy = core.buildAffectedRow(cand({}), 0.5, project, base);
  const screening = core.buildAffectedRow(cand({ legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "screening" });
  const absent = core.buildAffectedRow(cand({}), 0.5, project, { ...base, legVolumes: "network" });
  ok(JSON.stringify(screening) === JSON.stringify(legacy), "row: legVolumes:screening with an estimate attached is byte-identical to today");
  ok(JSON.stringify(absent) === JSON.stringify(legacy), "row: legVolumes:network with NO estimate is byte-identical to today");

  const network = core.buildAffectedRow(cand({ legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "network" });
  ok(network.volumeSource === "network_estimate", "row: network mode labels volumeSource network_estimate");
  ok(close(network.designHourVolumeVph, 1200 + 700, 1e-6), "row: design hour = Σ entering (main 2×600 + minor 2×350)");
  const nb = network.approaches.find((a) => a.direction === "NB");
  const eb = network.approaches.find((a) => a.direction === "EB");
  ok(close(nb.existingVolumeVph, 600 * 1.05, 0.2) && close(eb.existingVolumeVph, 350 * 1.05, 0.2), "row: approach no-build volumes are the leg volumes grown");
  ok(Array.isArray(network.legVolumes) && network.legVolumes.length === 4 && network.legVolumes.find((l) => l.direction === "EB").source === "class_default", "row: legVolumes provenance rides the row");
  ok(network.movementEstimate && network.movementEstimate.method === "ipf" && network.movementEstimate.matrix.NB.NB === 0, "row: movementEstimate diagnostics + matrix ride the row");
  ok(Array.isArray(nb.laneGroups) && nb.laneGroups.length === 3, "row: lane groups (L/T/R) exist without a UTDF record");
  ok(network.signalTiming && network.signalTiming.basis === "webster", "row: timing still resolves (Webster) from the leg volumes");

  // Measured UTDF record wins outright over the estimate.
  const utdf = { latitude: 40.5, longitude: -80.0, volumes: { NBL: 100, NBT: 800, NBR: 100, SBL: 90, SBT: 700, SBR: 90, EBL: 40, EBT: 200, EBR: 40, WBL: 30, WBT: 150, WBR: 30 } };
  const measured = core.buildAffectedRow(cand({ utdf, legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "network" });
  ok(measured.volumeSource === "utdf_tmc" && measured.legVolumes === undefined, "row: a measured record wins outright; no estimate fields printed");

  // A T-intersection (no WB leg): the absent leg prints no lane-group rows —
  // the estimate never invents a breakdown for a leg that is not there.
  const tJunction = [
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 0, cls: 2, oneWay: null },
    { bearingDeg: 270, cls: 4, oneWay: null },
  ];
  const tEstimate = core.buildLegEstimate(tJunction, { signalDesignHourVph: 1200 });
  const tRow = core.buildAffectedRow(cand({ legEstimate: tEstimate }), 0.5, project, { ...base, legVolumes: "network" });
  const wb = tRow.approaches.find((a) => a.direction === "WB");
  const tNb = tRow.approaches.find((a) => a.direction === "NB");
  ok(wb.existingVolumeVph === 0 && wb.laneGroups === undefined, "row: a T's absent leg carries 0 volume and NO lane groups");
  ok(Array.isArray(tNb.laneGroups) && tNb.laneGroups.length === 3 && tRow.legVolumes.length === 3, "row: the T's three real legs keep their lane groups and provenance");
}

// ---- 5. server: incident links → JunctionLeg[] (bearing, class, one-way sense) ----
{
  const { buildGraph } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
  const { junctionLegsAtNode, incidentLinks } = await import(path.resolve(here, "../src/lib/junction-legs.ts"));
  // RoadSegment tuple: [cls, lat1, lon1, lat2, lon2, lanes|null, maxspeed|null, name?, oneway?]
  // (oneway: 1 = a→b only, -1 = b→a only, 0 = two-way). Cross at (40.5, -80.0):
  // N and S legs primary two-way; E leg tertiary one-way b→a i.e. INTO the node; W leg tertiary two-way.
  const segs = [
    [2, 40.5, -80.0, 40.51, -80.0, null, null, "Main St", 0],
    [2, 40.49, -80.0, 40.5, -80.0, null, null, "Main St", 0],
    [4, 40.5, -80.0, 40.5, -79.99, null, null, "Oak Ave", -1],   // a = node, b = east; b→a only = travel toward the node
    [4, 40.5, -80.01, 40.5, -80.0, null, null, "Oak Ave", 0],    // a = west, b = node
  ];
  const g = buildGraph(segs);
  const node = g.nodeOf(40.5, -80.0);
  const legs = junctionLegsAtNode(g, node, incidentLinks(g));
  ok(legs.length === 4, "legs: four incident links — including the one-way link INTO the node that routing adjacency omits");
  const byCard = Object.fromEntries(legs.map((l) => [Math.round(l.bearingDeg / 90) * 90 % 360, l]));
  ok(byCard[0]?.cls === 2 && byCard[180]?.cls === 2 && byCard[90]?.cls === 4 && byCard[270]?.cls === 4, "legs: bearing and class per leg");
  ok(byCard[90]?.oneWay === "in" && byCard[0]?.oneWay === null && byCard[270]?.oneWay === null, "legs: one-way sense is relative to the node (east leg enters only)");
  ok(g.adj[node].length === 3, "legs: (sanity) routing adjacency at the node has only 3 links — why incidentLinks() exists");
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
