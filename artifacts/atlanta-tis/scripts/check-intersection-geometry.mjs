// Sanity for the explorer's plan builder (src/lib/intersection-geometry.ts).
//
// Rows come from the scenario solver's fixtures, which are REAL engine output
// (scripts/fixtures/README.md):
//
//   A  scenario-base.json       every row: no import attached, so NO approach
//                               carries laneGroups, throughLanes or a storage
//                               record — the common case the Lanes tab must
//                               describe honestly.
//   B  scenario-overrides.json  the same study with a protected NS left on
//                               ATL-69421277 (an override the engine applied),
//                               which is how a left bay appears without an
//                               import.
//
// NEITHER fixture carries laneGroups (no Synchro record was imported when they
// were generated), so the lane-group case is SYNTHESIZED here — not by typing
// numbers in, but by handing the engine's own `laneGroupsForApproach` a
// declared synthetic UTDF record (volumes, one storage length, lane counts)
// for a real row's NB approach. The values the check reads back are therefore
// the engine's, and the storage-deficiency flag under test is the one the
// engine set. The check prints that it did this.
//
// Assertions:
//   1. A row without laneGroups: hasLaneGroups false, every approach at the
//      engine's one-lane default, no bay, no storage, the default turn shares
//      stated, and every number finite.
//   2. Queue scaling: queue95Veh × 25 ft/veh === queue95thFt on every
//      approach of every row in A (the engine's VEH_LENGTH_FT).
//   3. A protected axis (B's override row) draws a left bay on NB and SB,
//      length assumed, basis "protected-phase"; EW has none.
//   4. The synthesized lane-group row: hasLaneGroups true, the L group's
//      storage on the approach, storageDeficient equal to the engine's flag
//      (and to queue > storage), lane counts from the record, basis
//      "lane-group"; a row-level existingStorageFt on another approach is
//      compared against that approach's queue.
//   5. Scenario pairs: planFromRow(baseRow, scenarioRow) keeps the base
//      values beside the scenario's and flags exactly the approaches whose
//      printed values differ; timingChanged is true for the override row.
//   6. No NaN / Infinity anywhere in any plan (deep walk).
//
// Run: `pnpm run check:intersection-geometry` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  planFromRow, movementsByApproach, QUEUE_FT_PER_VEH, ASSUMED_BAY_FT, DEFAULT_TURN_SHARES, DIRECTIONS,
} from "../src/lib/intersection-geometry.ts";
import { laneGroupsForApproach, VEH_LENGTH_FT, DEFAULT_LEFT_TURN_SHARE, DEFAULT_THROUGH_SHARE } from "@workspace/tis-engine-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", n), "utf8"));
const A = load("scenario-base.json");
const B = load("scenario-overrides.json");

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

function walkFinite(v, trail, bad) {
  if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(trail); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walkFinite(x, `${trail}[${i}]`, bad)); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkFinite(x, `${trail}.${k}`, bad);
}
const nonFinite = (plan) => { const bad = []; walkFinite(plan, "plan", bad); return bad; };

// ---------------------------------------------------------------------------
console.log("fixture coverage");
const anyLaneGroups = (rep) => rep.affectedIntersections.some((r) => r.approaches.some((a) => Array.isArray(a.laneGroups) && a.laneGroups.length > 0));
console.log(`  note  laneGroups in scenario-base.json: ${anyLaneGroups(A) ? "yes" : "NONE"}; in scenario-overrides.json: ${anyLaneGroups(B) ? "yes" : "NONE"}`);
console.log("  note  the lane-group case below is SYNTHESIZED through the engine's laneGroupsForApproach on a declared UTDF record");
ok(QUEUE_FT_PER_VEH === VEH_LENGTH_FT && VEH_LENGTH_FT === 25, `queue scale is the engine's VEH_LENGTH_FT (${VEH_LENGTH_FT} ft/veh)`);
ok(DEFAULT_TURN_SHARES.left === DEFAULT_LEFT_TURN_SHARE && DEFAULT_TURN_SHARES.through === DEFAULT_THROUGH_SHARE
  && Math.abs(DEFAULT_TURN_SHARES.left + DEFAULT_TURN_SHARES.through + DEFAULT_TURN_SHARES.right - 1) < 1e-12,
  `default turn shares are the engine's (L ${DEFAULT_TURN_SHARES.left}, T ${DEFAULT_TURN_SHARES.through}, R ${DEFAULT_TURN_SHARES.right.toFixed(2)})`);

// ---------------------------------------------------------------------------
console.log("\n1. a row without laneGroups (A, first row)");
const rowA = A.affectedIntersections[0];
const planA = planFromRow(rowA);
ok(planA.signalId === rowA.signalId && planA.name === rowA.name, "identity carried");
ok(planA.hasLaneGroups === false, "hasLaneGroups false");
ok(planA.scenario === false && planA.base === undefined && planA.timingChanged === false, "no scenario, no base pairs");
ok(planA.approaches.length === 4 && planA.approaches.map((a) => a.direction).join() === DIRECTIONS.join(), "four approaches in NB,SB,EB,WB order");
ok(planA.approaches.every((a) => a.throughLanes === 1 && a.lanesSource === "default"), "every approach at the engine's one-lane default, source \"default\"");
ok(planA.approaches.every((a) => a.leftBay.present === false && a.leftBay.assumed === false && a.leftBay.basis === undefined), "no left bay on a permissive row with no lane record");
ok(planA.approaches.every((a) => a.storageFt === undefined && a.storageDeficient === undefined && a.laneGroups === undefined), "no storage, no lane groups");
ok(planA.timing !== null && planA.timing.basis === rowA.signalTiming.basis && planA.timing.cycleLenSec === rowA.signalTiming.cycleLenSec
  && planA.timing.gOverC.ns === rowA.signalTiming.gOverCns && planA.timing.gOverC.ew === rowA.signalTiming.gOverCew
  && planA.timing.pedMin.ns === rowA.signalTiming.pedMinGreenNsSec, "timing summary reads the row's printed plan");
ok(planA.verdict.severity === rowA.mitigationSeverity && planA.verdict.mitigation === rowA.mitigation
  && planA.verdict.los.noBuild === rowA.existingLos && planA.verdict.los.build === rowA.futureLos
  && planA.verdict.delay.build === rowA.futureDelaySec && planA.verdict.worstQueueFt === rowA.queue95thFt, "verdict reads the row");
{
  const a = planA.approaches[0];
  const src = rowA.approaches[0];
  ok(a.vph.noBuild === src.existingVolumeVph && a.vph.build === src.futureVolumeVph && a.vc.build === src.futureVc
    && a.delay.noBuild === src.existingDelaySec && a.los.build === src.futureLos && a.addedTrips === src.addedTripsPeak,
    "approach values are the row's printed values, no-build → build");
}
// Movements: the plan's per-approach L/T/R must sum to the printed +Trips on
// every approach — the same cross-foot the engine's addedByMovement obeys.
{
  const mv = movementsByApproach(rowA);
  const crossFoot = rowA.approaches.every((ap) => {
    const s = mv[ap.direction].L + mv[ap.direction].T + mv[ap.direction].R;
    return s === ap.addedTripsPeak;
  });
  ok(crossFoot, "movements by approach cross-foot to each approach's printed +Trips");
  const engineByMv = rowA.approaches.every((ap) => !ap.addedByMovement
    || (ap.addedByMovement.L === mv[ap.direction].L && ap.addedByMovement.T === mv[ap.direction].T && ap.addedByMovement.R === mv[ap.direction].R));
  ok(engineByMv, "and equal the engine's own addedByMovement where the row prints it");
  ok(planA.hasMovements === true && planA.movementSource === rowA.movementSource, "movement table present with its source");
}
ok(planA.scaleFt === Math.max(...planA.approaches.map((a) => a.queue95Ft)), "scale is the longest queue when nothing else is drawn");
ok(nonFinite(planA).length === 0, "no NaN / Infinity in the plan");

// ---------------------------------------------------------------------------
console.log("\n2. queue scaling on every approach of every row in A");
{
  let rows = 0, apps = 0, bad = 0;
  for (const r of A.affectedIntersections) {
    const p = planFromRow(r);
    rows++;
    for (const a of p.approaches) {
      apps++;
      if (Math.abs(a.queue95Veh * 25 - a.queue95Ft) > 1e-9) bad++;
      if (a.queue95Ft !== r.approaches.find((x) => x.direction === a.direction).queue95thFt) bad++;
    }
    if (nonFinite(p).length > 0) bad++;
  }
  ok(bad === 0, `queue95Veh × 25 === queue95thFt on ${apps} approaches over ${rows} rows, all finite`);
}

// ---------------------------------------------------------------------------
console.log("\n3. a protected axis (B, the override row) draws an assumed left bay");
const rowB = B.affectedIntersections.find((r) => r.signalTiming?.leftPhasingNs === "protected");
ok(!!rowB, `found a protected-NS row in B (${rowB?.signalId})`);
if (rowB) {
  const planB = planFromRow(rowB);
  const ns = planB.approaches.filter((a) => a.direction === "NB" || a.direction === "SB");
  const ew = planB.approaches.filter((a) => a.direction === "EB" || a.direction === "WB");
  ok(ns.length === 2 && ns.every((a) => a.leftBay.present && a.leftBay.assumed && a.leftBay.basis === "protected-phase" && a.leftBay.storageFt === undefined),
    "NB and SB: bay present, length assumed, basis protected-phase");
  ok(ew.every((a) => !a.leftBay.present), "EB and WB: no bay");
  ok(ns.every((a) => a.storageFt === undefined), "an assumed bay carries no storage (nothing to compare the queue against)");
  ok(planB.scaleFt >= ASSUMED_BAY_FT, `scale covers the assumed bay (${ASSUMED_BAY_FT} ft)`);
  ok(planB.timing?.gOverC.nsLeft === rowB.signalTiming.gOverCnsLeft && planB.timing?.leftPhasing.ns === "protected" && planB.timing?.source === "override",
    "timing summary carries the left g/C, phasing and override source");
  ok(nonFinite(planB).length === 0, "no NaN / Infinity");
}

// ---------------------------------------------------------------------------
console.log("\n4. a row WITH laneGroups (synthesized through the engine)");
{
  // A declared synthetic Synchro record for rowA's NB approach: measured
  // turning movements, one imported bay, and [Lanes] counts. Everything the
  // check reads back is what laneGroupsForApproach makes of it.
  const nb = rowA.approaches.find((a) => a.direction === "NB");
  const utdf = {
    volumes: { NBL: 120, NBT: 300, NBR: 40 },
    storageFt: { NBL: 100 },
    lanes: { NBL: 1, NBT: 2, NBR: 1 },
  };
  const t = rowA.signalTiming;
  const laneCapacityVph = nb.futureVolumeVph / nb.futureVc; // the approach's own capacity basis, one lane
  const groups = laneGroupsForApproach({
    approach: "NB",
    utdf,
    approachVolumeVph: nb.existingVolumeVph,
    addedExactByMovement: { L: 0, T: 0, R: nb.addedTripsPeak },
    addedTripsPeak: nb.addedTripsPeak,
    laneCapacityVph,
    cycleLenS: t.cycleLenSec,
    gOverCByMovement: { L: t.gOverCns, T: t.gOverCns, R: t.gOverCns },
    useRealLaneGeometry: true,
  });
  ok(Array.isArray(groups) && groups.length === 3, "engine produced three lane groups from the synthetic record");
  const L = groups?.find((g) => g.movement === "L");
  console.log(`  note  engine L group: Q95 ${L?.queue95thFt} ft vs storage ${L?.storageFt} ft → deficient ${L?.storageDeficient}`);
  const rowLG = {
    ...rowA,
    existingStorageFt: 90, storageMovement: "EBL",           // a row-level bay on ANOTHER approach
    approaches: rowA.approaches.map((a) => a.direction === "NB"
      ? { ...a, throughLanes: 2, lanesSource: "import", laneGroups: groups }
      : a),
  };
  const planLG = planFromRow(rowLG);
  const nbp = planLG.approaches.find((a) => a.direction === "NB");
  ok(planLG.hasLaneGroups === true, "hasLaneGroups true");
  ok(nbp.throughLanes === 2 && nbp.lanesSource === "import", "NB through lanes from the import (2, source import)");
  ok(nbp.leftBay.present && nbp.leftBay.assumed === false && nbp.leftBay.basis === "lane-group" && nbp.leftBay.storageFt === 100,
    "NB left bay from the L group with its storage (100 ft), not assumed");
  ok(nbp.storageFt === 100 && nbp.storageBasis === "lane-group", "NB storage is the L group's");
  ok(nbp.storageDeficient === L.storageDeficient && nbp.storageDeficient === (L.queue95thFt > L.storageFt),
    `NB storageDeficient is the engine's flag (${nbp.storageDeficient}) and equals queue > storage`);
  ok(nbp.laneGroups === groups, "the lane groups ride along for the Lanes tab");
  const ebp = planLG.approaches.find((a) => a.direction === "EB");
  ok(ebp.storageFt === 90 && ebp.storageBasis === "row" && ebp.storageDeficient === (ebp.queue95Ft > 90),
    `EB storage from the row-level bay (90 ft) against the approach queue (${ebp.queue95Ft} ft → deficient ${ebp.storageDeficient})`);
  ok(ebp.leftBay.present === true && ebp.leftBay.assumed === false && ebp.leftBay.basis === "storage-record" && ebp.leftBay.storageFt === 90,
    "a row-level EBL storage record is a bay on record: drawn at its 90 ft, basis storage-record, not assumed");
  const planRight = planFromRow({ ...rowLG, storageMovement: "EBR" });
  const ebr = planRight.approaches.find((a) => a.direction === "EB");
  ok(ebr.leftBay.present === false && ebr.storageFt === 90 && ebr.storageBasis === "row",
    "a row-level EBR record compares against the approach queue but draws no LEFT bay");
  ok(planLG.scaleFt >= Math.max(100, L.queue95thFt, 90), "scale covers the bay and the group queue");
  ok(nonFinite(planLG).length === 0, "no NaN / Infinity");

  // A lane group with a deficient bay must flag; build one by shrinking the
  // bay below the engine's queue for the same record.
  const short = { ...utdf, storageFt: { NBL: 5 } };
  const groupsShort = laneGroupsForApproach({
    approach: "NB", utdf: short, approachVolumeVph: nb.existingVolumeVph,
    addedExactByMovement: { L: 0, T: 0, R: nb.addedTripsPeak }, addedTripsPeak: nb.addedTripsPeak,
    laneCapacityVph, cycleLenS: t.cycleLenSec, gOverCByMovement: { L: t.gOverCns, T: t.gOverCns, R: t.gOverCns }, useRealLaneGeometry: true,
  });
  const planShort = planFromRow({ ...rowA, approaches: rowA.approaches.map((a) => a.direction === "NB" ? { ...a, laneGroups: groupsShort } : a) });
  const nbs = planShort.approaches.find((a) => a.direction === "NB");
  ok(nbs.storageDeficient === true && nbs.storageFt === 5 && groupsShort.find((g) => g.movement === "L").storageDeficient === true,
    "a 5 ft bay under the engine's queue is flagged deficient (engine flag and plan agree)");
}

// ---------------------------------------------------------------------------
console.log("\n5. scenario pairs: base row → scenario row");
{
  const baseRow = A.affectedIntersections.find((r) => r.signalId === rowB.signalId);
  const plan = planFromRow(baseRow, rowB);
  ok(plan.scenario === true && !!plan.base, "scenario drawn with base kept");
  ok(plan.timingChanged === true && plan.base.timing?.leftPhasing.ns === "permissive" && plan.timing?.leftPhasing.ns === "protected",
    "timingChanged: base permissive → scenario protected NS left");
  ok(plan.approaches.every((a) => !!a.base), "every approach carries its base values");
  const expectChanged = plan.approaches.map((a) => {
    const b = baseRow.approaches.find((x) => x.direction === a.direction);
    const s = rowB.approaches.find((x) => x.direction === a.direction);
    return ["existingVolumeVph", "futureVolumeVph", "existingVc", "futureVc", "existingDelaySec", "futureDelaySec", "existingLos", "futureLos", "queue95thFt", "addedTripsPeak"]
      .some((k) => b[k] !== s[k]);
  });
  ok(plan.approaches.every((a, i) => a.changed === expectChanged[i]), `changed flags match the printed differences (${expectChanged.filter(Boolean).length} of 4 approaches differ)`);
  ok(plan.approaches.every((a) => {
    const b = baseRow.approaches.find((x) => x.direction === a.direction);
    return a.base.delay.build === b.futureDelaySec && a.base.queue95Ft === b.queue95thFt && a.base.los.build === b.futureLos;
  }), "base values are the base row's printed values");
  ok(plan.base.verdict.delay.build === baseRow.futureDelaySec && plan.verdict.delay.build === rowB.futureDelaySec, "verdict pair reads both rows");
  const same = planFromRow(baseRow, baseRow);
  ok(same.scenario === false && same.base === undefined, "the same object as scenario row is not a scenario");
  const identical = planFromRow(baseRow, { ...baseRow });
  ok(identical.scenario === true && identical.approaches.every((a) => a.changed === false) && identical.timingChanged === false,
    "an unchanged copy flags nothing");
  ok(nonFinite(plan).length === 0, "no NaN / Infinity");
}

// ---------------------------------------------------------------------------
console.log("\n6. every row in both fixtures, base and paired");
{
  let bad = 0, n = 0;
  const byId = new Map(B.affectedIntersections.map((r) => [r.signalId, r]));
  for (const r of A.affectedIntersections) {
    n++;
    const p = planFromRow(r, byId.get(r.signalId) ?? null);
    const nf = nonFinite(p);
    if (nf.length > 0) { bad++; console.log("  non-finite at " + nf.slice(0, 3).join(", ")); }
  }
  ok(bad === 0, `no NaN / Infinity across ${n} paired rows`);
  // A degenerate row (no approaches, no timing, no movements) must not throw.
  const bare = planFromRow({ ...rowA, approaches: [], signalTiming: undefined, movements: undefined, movementSource: undefined });
  ok(bare.approaches.length === 0 && bare.timing === null && bare.hasMovements === false && bare.scaleFt === 0 && nonFinite(bare).length === 0,
    "a row with no approaches, timing or movements yields an empty, finite plan");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-geometry passed");
process.exit(failed ? 1 : 0);
