/**
 * Intersection study model — the section inputs of one signal's study
 * (components/intersection-study.tsx, spec §3.2a), built from the report row
 * and, when the studio has edits for this signal, its scenario re-solve.
 *
 * Pure: no DOM, no React, so `scripts/check-intersection-study.mjs` builds the
 * model for every studied row headless. Nothing here computes a result
 * the report does not carry, with four disclosed exceptions, each an engine
 * function called with the row's own inputs (`ENGINE_RECOMPUTATIONS` lists
 * them for the §00 sentence):
 *
 *   §02 capacity     approachCap() as row-math.ts computes it —
 *                    SATURATION_FLOW_VPH × g/C(approach) × through lanes ×
 *                    weather factor — so the queue animation discharges at the
 *                    rate the printed v/c was computed against. The check
 *                    asserts vph ÷ capacity reproduces the printed v/c. The
 *                    weather factor is the one the DRAWN row was solved with:
 *                    the scenario's when the studio changed the weather
 *                    (scenario-solve.ts scenarioWeatherFactor), else the
 *                    report's.
 *   §02/§04 no-build Q95   queue95Ft(no-build vph, capacity, cycle, g/C): the
 *                    row prints only the BUILD queue per approach; the same
 *                    function on the same capacity gives the no-build one. The
 *                    check asserts the build recomputation reproduces the
 *                    printed queue. Labelled "recomputed" wherever shown.
 *   §02 Q1           the engine's average back-of-queue, Q95 ÷ 1.65 — its own
 *                    Poisson factor, backed out, not a separate measurement.
 *   §03 Webster      computeSignalTiming() on the printed no-build volumes and
 *                    lane counts — plus, when the row carries an import, the
 *                    measured left share (lane groups) and the measured cycle
 *                    (utdfCycleLenSec), exactly what row-math.ts hands the
 *                    fallback — for comparison beside the plan in use. On a
 *                    row whose basis already is "webster" (or "measured-cycle")
 *                    this reproduces the printed plan.
 *
 * LANES. The engine's per-approach Q95 is the approach TOTAL (queue95Ft on the
 * whole approach's vph against the whole approach's capacity), in vehicles ×
 * 25 ft. The §02 lane animation draws ONE lane at λ ÷ lanes, so its marks are
 * the per-lane share: Q95 ÷ lanes, Q1 ÷ lanes (`q95PerLaneFt`, `avgQueuePerLane*`)
 * — the division the queuing study makes (tis-api-server queuing.ts
 * `Q_95_perLane = Q_95 / laneCount`). The table keeps the printed total.
 *
 * Sections (the study's § numbers):
 *   00 summary     the verdict strip, base → scenario pairs
 *   01 approaches  the plan (intersection-geometry.ts planFromRow) — lanes,
 *                  bays, queues, movements, the honest lane statement
 *   02 queuing     per-approach inputs for the lane animation and the
 *                  queue-vs-storage bar, with the deficiency flag exactly as
 *                  the plan carries it
 *   03 timing      the plan in use, the base plan when a scenario is drawn,
 *                  and the Webster comparison
 *   04 simulation  simInputsFromRow for both scenarios (the SCENARIO row's
 *                  timing and volumes when one is drawn) beside the engine's
 *                  per-approach delay and Q95 for the readout
 *   05 what-if     the SignalControls seed: timingEditFromRow(drawn row) —
 *                  exactly what the studio's Signal tab seeds from
 *   06 mitigation  verdict text, turbo-lane screen, method notes
 */
import type { TisAffectedIntersection, TisAffectedIntersectionSignalTiming } from "@workspace/tis-api-client-react";
import {
  SATURATION_FLOW_VPH, VEH_LENGTH_FT, G_OVER_C, LOST_TIME_PER_PHASE_S,
  DEFAULT_THROUGH_LANES_PER_DIR, queue95Ft, computeSignalTiming, type SignalTiming,
} from "@workspace/tis-engine-core";
import {
  planFromRow, timingSummary, verdictFromRow, axisOf, DIRECTIONS,
  type IntersectionPlan, type ApproachPlan, type TimingSummary, type Verdict, type Direction, type Pair, type Los,
} from "./intersection-geometry.ts";
import { simInputsFromRow, fallbackCycleSec, type IntersectionSimInputs } from "./intersection-sim.ts";
import { timingEditFromRow, type SignalTimingEdit } from "./scenario-solve.ts";

export type StorageVerdict = "pass" | "fail" | "not_measured";

/** One approach's inputs for the §02 lane animation and queue bar. */
export type QueueApproachModel = {
  direction: Direction;
  /** Approach demand in the drawn scenario's BUILD case, vph. */
  arrivalVph: number;
  /** Per-lane arrival rate, vph — arrivalVph ÷ lanes, as the queuing study splits it. */
  arrivalPerLaneVph: number;
  lanes: number;
  lanesSource: ApproachPlan["lanesSource"];
  satFlowVphpl: number;
  cycleSec: number;
  /** Effective green, s — g/C × cycle. */
  effectiveGreenSec: number;
  gOverC: number;
  /** Engine approach capacity, vph (all lanes), = s × g/C × lanes × weather. */
  capacityVph: number;
  capacityPerLaneVph: number;
  /** Printed build v/c from the row. */
  vOverC: number;
  /** vph ÷ capacityVph, unrounded — should reproduce vOverC within rounding. */
  vOverCRecomputed: number;
  /** The row's printed 95th-percentile queue (build) — the approach TOTAL across its lanes — ft and vehicles. */
  q95Ft: number;
  q95Veh: number;
  /** The printed Q95 ÷ lanes: the per-lane share the one-lane animation is marked with. Equals q95Ft on a one-lane approach. */
  q95PerLaneFt: number;
  q95PerLaneVeh: number;
  /** The engine's own queue95Ft on the no-build volume, ft (approach total) — recomputed, not printed. */
  q95NoBuildFt: number;
  /** queue95Ft(build) recomputed from the same inputs, for the check. */
  q95RecomputedFt: number;
  /** The engine's average back-of-queue Q1 = Q95 ÷ 1.65, its own Poisson factor (signal-delay.ts) — approach total. */
  avgQueueVeh: number;
  avgQueueFt: number;
  /** Q1 ÷ lanes, for the one-lane animation. */
  avgQueuePerLaneVeh: number;
  avgQueuePerLaneFt: number;
  /**
   * The lane's expected END-OF-RED queue, λ(C − g) per lane, vehicles — the
   * queuing study's Q_avg (tis-api-server queuing.ts) and the quantity the
   * animation's "end-of-red mean" measures. Webster's Q1 above is larger by
   * 1 ÷ (1 − x·g/C): it counts vehicles still joining the back of the queue
   * while the front discharges. The two are different quantities and are
   * labelled as such.
   */
  endOfRedMeanPerLaneVeh: number;
  storageFt: number | null;
  storageBasis?: ApproachPlan["storageBasis"];
  /** The queue the storage flag compared (the L group's own, or the row's worst approach) — see intersection-geometry.ts. */
  storageQueueFt: number | null;
  storageQueueBasis?: ApproachPlan["storageQueueBasis"];
  storageDeficient: boolean | null;
  verdict: StorageVerdict;
  /** True when the row carried no timing and the screening default sized capacity (on the imported cycle when the row carries one). */
  timingAssumed: boolean;
  weatherFactor: number;
};

export type TimingModel = {
  /** The plan in use on the drawn row. */
  current: TimingSummary | null;
  /** The base row's plan when a scenario row is drawn. */
  base: TimingSummary | null;
  changed: boolean;
  /** Webster optimum recomputed from the drawn row's printed no-build volumes and lanes. */
  webster: SignalTiming;
  /** True when the plan in use IS the Webster plan (basis "webster" and the recomputation matches). */
  websterInUse: boolean;
  /** The engine's lost time per phase, s, for the splits table. */
  lostTimePerPhaseS: number;
  /** Displayed splits, s — g/C × C + lost time per phase. */
  splits: { ns: number; ew: number; nsLeft?: number; ewLeft?: number } | null;
};

export type SimModel = {
  nobuild: IntersectionSimInputs;
  build: IntersectionSimInputs;
  /**
   * Engine readout per approach. `delay` is the row's PRINTED control delay
   * (calibrated: × the row's delay multiplier); `delayUncalibrated` divides
   * that multiplier back out — the raw vcToDelay figure, which is what the
   * uncalibrated sim measures and what the readout compares. Q95: build
   * printed, no-build recomputed (queue95Ft on the same capacity) — both the
   * approach TOTAL across lanes, the engine's own basis.
   */
  engine: Record<Direction, { delay: Pair<number>; delayUncalibrated: Pair<number>; q95Ft: Pair<number>; los: Pair<Los> }>;
  /** The row's delay calibration multiplier as the engine clamps it (row-math.ts calMul, 0.25–5); 1 when uncalibrated. */
  calibrationMultiplier: number;
  /** The weather factor the sim discharges at (satFlowVphpl = 1800 × this). */
  weatherFactor: number;
  /** True when a scenario row drives the sim (its timing and volumes). */
  scenario: boolean;
  /** The ±band check:intersection-sim documents for simulated vs computed delay. */
  agreementBand: number;
  /** Exactly the conditions under which check:intersection-sim asserts that band. */
  agreementConditions: string;
};

export type WhatIfModel = {
  /** The seed for SignalControls — timingEditFromRow(drawn row), null without a plan. */
  edit: SignalTimingEdit | null;
  /** The drawn row's resolved timing record (g/C readouts, ped minimums, provenance). */
  timing: TisAffectedIntersectionSignalTiming | undefined;
  /** The base row's cycle, for the cycle slider's "base →" readout. */
  baseCycleLenSec: number | undefined;
};

export type MitigationModel = {
  severity: string;
  mitigation: string;
  base?: { severity: string; mitigation: string };
  turboLane: Record<string, unknown> | null;
  /** Why the turbo-lane screen has nothing: absent inputs ⇒ geometry never a candidate. */
  turboScreened: boolean;
  /** Method notes that apply to THIS row, in plain words. */
  methodNotes: string[];
};

export type SummaryModel = Verdict & {
  timingBasis: string;
  timingSource?: string;
  base?: Verdict & { timingBasis: string };
  /** The sim's notes — the defaults the study discloses up front. */
};

export type IntersectionStudyModel = {
  signalId: string;
  name: string;
  zone: string;
  distanceMi: number;
  scenario: boolean;
  summary: SummaryModel;
  plan: IntersectionPlan;
  queuing: QueueApproachModel[];
  timing: TimingModel;
  sim: SimModel;
  whatIf: WhatIfModel;
  mitigation: MitigationModel;
  /** The section ids in order, as the study's nav lists them. */
  sections: readonly { id: SectionId; n: string; label: string }[];
};

export type SectionId = "summary" | "approaches" | "queuing" | "timing" | "simulation" | "whatif" | "mitigation";

export const SECTIONS: readonly { id: SectionId; n: string; label: string }[] = [
  { id: "summary", n: "00", label: "Summary" },
  { id: "approaches", n: "01", label: "Approaches & lanes" },
  { id: "queuing", n: "02", label: "Queuing" },
  { id: "timing", n: "03", label: "Signal timing" },
  { id: "simulation", n: "04", label: "Simulation" },
  { id: "whatif", n: "05", label: "What-if" },
  { id: "mitigation", n: "06", label: "Mitigation & method" },
];

export type StudyModelOptions = {
  /**
   * The capacity weather factor the DRAWN row was solved with: the report's
   * `weatherFactorExact ?? weatherCapacityFactor`, or the scenario's when the
   * studio changed the weather (scenario-solve.ts scenarioWeatherFactor).
   * Default 1. Sizes the §02 capacity and the §04 sim's discharge rate.
   */
  weatherFactor?: number;
};

/** The engine's Poisson incremental factor Q95 = Q1 × 1.65 (signal-delay.ts queue95Ft). */
export const Q95_FACTOR = 1.65;
/** The band check:intersection-sim documents for simulated vs computed delay. */
export const SIM_AGREEMENT_BAND = 0.40;
/** The conditions check:intersection-sim (f) asserts SIM_AGREEMENT_BAND under — stated verbatim wherever the band is quoted. */
export const SIM_AGREEMENT_CONDITIONS = "no-build volumes, Webster-basis timing, v/c ≤ 0.7 on every approach, uncalibrated delay, seed 42, 30 cycles (60 in the sweep)";
/**
 * The engine functions this model runs in the browser on the row's own
 * inputs — the only figures on the page the report does not print. §00
 * names them.
 */
export const ENGINE_RECOMPUTATIONS: readonly string[] = [
  "the §02 approach capacity (1800 × g/C × lanes × weather, as row-math.ts approachCap sizes it)",
  "the no-build 95th-percentile queue in §02 and §04 (queue95Ft on the no-build volume; the row prints only the build queue)",
  "the §02 average queue Q1 (the printed Q95 ÷ 1.65, the engine's own factor)",
  "the §03 Webster comparison (computeSignalTiming on the printed no-build volumes)",
];

/** The engine's calibration multiplier for a row as row-math.ts clamps it (calMul: 0.25–5); 1 when the row is uncalibrated. */
export function calibrationMultiplierOf(row: Pick<TisAffectedIntersection, "calibration">): number {
  const c = row.calibration;
  const raw = c ? (c.delayMultiplierExact ?? c.delayMultiplier) : 1;
  const m = typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
  return Math.min(5, Math.max(0.25, m));
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, fallback = 0): number => (finite(v) ? v : fallback);

/** The through phase's g/C for an approach: exact ratio when printed, else the rounded one. */
function gOverCFor(t: TisAffectedIntersectionSignalTiming | undefined, d: Direction): number {
  if (!t) return G_OVER_C;
  return axisOf(d) === "ns" ? (t.gOverCnsExact ?? t.gOverCns) : (t.gOverCewExact ?? t.gOverCew);
}

function queueModel(a: ApproachPlan, row: TisAffectedIntersection, weatherFactor: number): QueueApproachModel {
  const t = row.signalTiming;
  const timingAssumed = !t;
  // No plan ⇒ the engine still computed delay and queue on the imported
  // cycle when the row carries one (row-math.ts `cyc`), else the default.
  const cycleSec = t ? num(t.cycleLenSec, fallbackCycleSec(row)) : fallbackCycleSec(row);
  const gOverC = gOverCFor(t, a.direction);
  const lanes = Math.max(1, a.throughLanes || DEFAULT_THROUGH_LANES_PER_DIR);
  const satFlowVphpl = SATURATION_FLOW_VPH * weatherFactor;
  const capacityPerLaneVph = satFlowVphpl * gOverC;
  const capacityVph = capacityPerLaneVph * lanes;
  const arrivalVph = a.vph.build;
  const arrivalPerLaneVph = arrivalVph / lanes;
  const effectiveGreenSec = gOverC * cycleSec;
  const q95RecomputedFt = queue95Ft(arrivalVph, capacityVph, cycleSec, gOverC);
  const q95NoBuildFt = queue95Ft(a.vph.noBuild, capacityVph, cycleSec, gOverC);
  const q95Veh = a.queue95Ft / VEH_LENGTH_FT;
  const avgQueueVeh = q95Veh / Q95_FACTOR;
  const storageFt = a.storageFt ?? null;
  const storageDeficient = storageFt !== null ? !!a.storageDeficient : null;
  return {
    direction: a.direction,
    arrivalVph,
    arrivalPerLaneVph,
    lanes,
    lanesSource: a.lanesSource,
    satFlowVphpl,
    cycleSec,
    effectiveGreenSec,
    gOverC,
    capacityVph,
    capacityPerLaneVph,
    vOverC: a.vc.build,
    vOverCRecomputed: capacityVph > 0 ? arrivalVph / capacityVph : 0,
    q95Ft: a.queue95Ft,
    q95Veh,
    q95PerLaneFt: a.queue95Ft / lanes,
    q95PerLaneVeh: q95Veh / lanes,
    q95NoBuildFt,
    q95RecomputedFt,
    avgQueueVeh,
    avgQueueFt: a.queue95Ft / Q95_FACTOR,
    avgQueuePerLaneVeh: avgQueueVeh / lanes,
    avgQueuePerLaneFt: a.queue95Ft / Q95_FACTOR / lanes,
    endOfRedMeanPerLaneVeh: (arrivalPerLaneVph / 3600) * Math.max(0, cycleSec - effectiveGreenSec),
    storageFt,
    ...(a.storageBasis ? { storageBasis: a.storageBasis } : {}),
    storageQueueFt: storageFt !== null && finite(a.storageQueueFt) ? a.storageQueueFt : null,
    ...(a.storageQueueBasis ? { storageQueueBasis: a.storageQueueBasis } : {}),
    storageDeficient,
    verdict: storageFt === null ? "not_measured" : storageDeficient ? "fail" : "pass",
    timingAssumed,
    weatherFactor,
  };
}

/**
 * The engine's fallback plan for the drawn row — its own computeSignalTiming
 * on the printed no-build volumes and lane counts, plus what row-math.ts
 * resolveTimingForRow hands it when the row carries an import: the measured
 * left share per approach (the lane groups' L volume over the approach's
 * lane-group total, applied to the same no-build approach volume) and the
 * measured cycle (utdfCycleLenSec → measuredCycleS, basis "measured-cycle").
 * Without an import this is Webster's optimum, and on a row whose basis is
 * "webster" it reproduces the printed plan.
 */
export function websterForRow(row: TisAffectedIntersection): SignalTiming {
  const approachVph: Partial<Record<Direction, number>> = {};
  const leftVph: Partial<Record<Direction, number>> = {};
  const lanes: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const a of row.approaches ?? []) {
    const d = a.direction as Direction;
    approachVph[d] = num(a.existingVolumeVph);
    const known = finite(a.throughLanes) && a.throughLanes > 0 && (a.lanesSource === "import" || a.lanesSource === "osm");
    lanes[d] = known ? Math.round(a.throughLanes as number) : 0;
    // Measured left share: row-math.ts leftVph[d] = approachVph[d] × (L ÷ Σ LTR of the record);
    // the lane groups carry that split as existingVolumeVph per movement.
    const lg = Array.isArray(a.laneGroups) ? a.laneGroups : undefined;
    if (lg && lg.length > 0) {
      const tot = lg.reduce((s, g) => s + Math.max(0, num(g.existingVolumeVph)), 0);
      const l = lg.find((g) => g.movement === "L");
      if (tot > 0 && l && finite(l.existingVolumeVph) && l.existingVolumeVph >= 0) leftVph[d] = num(approachVph[d]) * (Math.max(0, l.existingVolumeVph) / tot);
    }
  }
  const lanesPerDir = {
    ns: Math.max(lanes.NB, lanes.SB) || DEFAULT_THROUGH_LANES_PER_DIR,
    ew: Math.max(lanes.EB, lanes.WB) || DEFAULT_THROUGH_LANES_PER_DIR,
  };
  const measuredCycleS = finite(row.utdfCycleLenSec) && row.utdfCycleLenSec > 0 ? row.utdfCycleLenSec : undefined;
  return computeSignalTiming({
    approachVph,
    ...(Object.keys(leftVph).length > 0 ? { leftVph } : {}),
    opposingLanes: { ns: lanesPerDir.ns, ew: lanesPerDir.ew },
    // Pedestrians walking with the NS phase cross the EW street (row-math.ts).
    crossingLanes: { ns: 2 * lanesPerDir.ew, ew: 2 * lanesPerDir.ns },
    ...(measuredCycleS !== undefined ? { measuredCycleS } : {}),
  });
}

function sameWebster(t: TimingSummary | null, w: SignalTiming): boolean {
  if (!t || (t.basis !== "webster" && t.basis !== "measured-cycle") || t.basis !== w.basis) return false;
  const close = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined) || (a !== undefined && b !== undefined && Math.abs(a - b) < 0.0015);
  return t.cycleLenSec === w.cycleLenS && close(t.gOverC.ns, w.gOverCns) && close(t.gOverC.ew, w.gOverCew)
    && close(t.gOverC.nsLeft, w.gOverCnsLeft) && close(t.gOverC.ewLeft, w.gOverCewLeft);
}

const BASIS_LABEL: Record<string, string> = {
  webster: "Webster optimum from no-build volumes",
  measured: "measured plan (Synchro)",
  "measured-cycle": "measured cycle, Webster splits",
  "screening-default": "screening default (90 s, g/C 0.45)",
};

export function timingBasisLabel(t: TimingSummary | null): string {
  if (!t) return "screening basis (no timing resolved)";
  if (t.source === "override") return "your plan (scenario override)";
  return BASIS_LABEL[t.basis] ?? t.basis;
}

function methodNotes(row: TisAffectedIntersection, plan: IntersectionPlan, sim: IntersectionSimInputs, weatherFactor: number): string[] {
  const notes: string[] = [];
  const t = plan.timing;
  notes.push(t
    ? `Signal timing: ${timingBasisLabel(t)}${t.source && t.source !== "override" ? ` (source ${t.source})` : ""}; ${t.cycleLenSec} s cycle, ${t.criticalPhases} critical phases, ${LOST_TIME_PER_PHASE_S} s lost time per phase.`
    : `Signal timing: no plan resolved on this row — the screening g/C ${G_OVER_C} sized its capacity${fallbackCycleSec(row) !== 90 ? ` on the imported ${fallbackCycleSec(row)} s cycle` : " on the 90 s default cycle"}.`);
  notes.push(`Approach capacity = ${SATURATION_FLOW_VPH} vphpl × g/C × through lanes × weather factor${weatherFactor !== 1 ? ` (${weatherFactor.toFixed(2)} on this row)` : ""}; delay by Webster d1 + Akçelik d2 (vcToDelay, T = 0.25 h, capped at 300 s); 95th-percentile queue = Q1 × ${Q95_FACTOR} at ${VEH_LENGTH_FT} ft per vehicle, the approach total across its lanes.`);
  if (row.volumeSource) notes.push(`Background volumes: measured turning-movement total from the attached ${row.volumeSource === "synchro_pdf_tmc" ? "Synchro report" : "UTDF record"}${finite(row.designHourVolumeVph) ? ` (design hour ${row.designHourVolumeVph.toFixed(0)} vph)` : ""}.`);
  else if (finite(row.designHourVolumeVph)) notes.push(`Background volumes: inventory design hour ${row.designHourVolumeVph.toFixed(0)} vph, grown to the opening year.`);
  if (plan.hasLaneGroups) notes.push("Per-movement lane groups, storage and turning counts come from the attached Synchro record.");
  else notes.push(`No Synchro record on this signal: through lanes ${plan.approaches.map((a) => `${a.direction} ${a.throughLanes} (${a.lanesSource})`).join(", ")}; background turns at the engine's ${(plan.defaultTurnShares.left * 100).toFixed(0)}/${(plan.defaultTurnShares.through * 100).toFixed(0)}/${(plan.defaultTurnShares.right * 100).toFixed(0)} L/T/R convention.`);
  if (plan.hasMovements) notes.push(`Project trips by movement ${plan.movementSource === "path" ? "from the routed paths through this junction (conserved assignment)" : plan.movementSource === "octant" ? "from the geometric octant model" : ""}.`.replace(" .", "."));
  if (row.calibration && row.calibration.sampleCount > 0) notes.push(`Screening delay calibrated against ${row.calibration.sampleCount} observed sample${row.calibration.sampleCount === 1 ? "" : "s"} (multiplier ×${row.calibration.delayMultiplier.toFixed(2)}).`);
  for (const n of sim.notes) notes.push(`Simulation: ${n}`);
  return notes;
}

function sameVerdict(a: Verdict, b: Verdict): boolean {
  return a.los.noBuild === b.los.noBuild && a.los.build === b.los.build
    && a.delay.noBuild === b.delay.noBuild && a.delay.build === b.delay.build
    && a.vc.noBuild === b.vc.noBuild && a.vc.build === b.vc.build
    && a.worstQueueFt === b.worstQueueFt && a.addedTrips === b.addedTrips
    && a.severity === b.severity && a.mitigation === b.mitigation && a.losChanged === b.losChanged;
}

/**
 * True when a scenario row prints anything different from its base row —
 * the verdict, the timing plan, or any approach value. A studio edit on
 * ANOTHER signal re-solves every row, so an unedited signal's scenario row
 * is a fresh object equal to its base; that is not a scenario for this
 * signal and the study must not say "· scenario" over it.
 */
export function scenarioRowDiffers(row: TisAffectedIntersection, scenarioRow: TisAffectedIntersection | null | undefined): boolean {
  if (!scenarioRow || scenarioRow === row) return false;
  const plan = planFromRow(row, scenarioRow);
  return plan.timingChanged || plan.approaches.some((a) => a.changed) || !sameVerdict(verdictFromRow(scenarioRow), verdictFromRow(row))
    || plan.approaches.length !== (row.approaches ?? []).length;
}

/**
 * The study model for `row`, or for `scenarioRow` with `row` kept as the base.
 * Every section's inputs come out of the drawn row; `base` fields carry the
 * base row's printed values wherever the study shows a base → scenario pair.
 * A scenario row that prints nothing different from the base (an edit on
 * another signal) is treated as no scenario at all.
 */
export function studyModelFromRow(
  row: TisAffectedIntersection,
  scenarioRow?: TisAffectedIntersection | null,
  opts: StudyModelOptions = {},
): IntersectionStudyModel {
  const scenario = scenarioRowDiffers(row, scenarioRow);
  const drawn = scenario && scenarioRow ? scenarioRow : row;
  const weatherFactor = finite(opts.weatherFactor) && opts.weatherFactor > 0 ? opts.weatherFactor : 1;
  const plan = planFromRow(row, scenario ? scenarioRow ?? null : null);
  const verdict = verdictFromRow(drawn);
  const baseVerdict = scenario ? verdictFromRow(row) : undefined;
  const timing = timingSummary(drawn);
  const baseTiming = scenario ? timingSummary(row) : null;

  const summary: SummaryModel = {
    ...verdict,
    timingBasis: timingBasisLabel(timing),
    ...(timing?.source ? { timingSource: timing.source } : {}),
    ...(baseVerdict ? { base: { ...baseVerdict, timingBasis: timingBasisLabel(baseTiming) } } : {}),
  };

  const queuing = plan.approaches.map((a) => queueModel(a, drawn, weatherFactor));

  const webster = websterForRow(drawn);
  const t = drawn.signalTiming;
  const splits = t
    ? {
      ns: (t.gOverCnsExact ?? t.gOverCns) * t.cycleLenSec + LOST_TIME_PER_PHASE_S,
      ew: (t.gOverCewExact ?? t.gOverCew) * t.cycleLenSec + LOST_TIME_PER_PHASE_S,
      ...(finite(t.gOverCnsLeft) ? { nsLeft: (t.gOverCnsLeftExact ?? t.gOverCnsLeft) * t.cycleLenSec + LOST_TIME_PER_PHASE_S } : {}),
      ...(finite(t.gOverCewLeft) ? { ewLeft: (t.gOverCewLeftExact ?? t.gOverCewLeft) * t.cycleLenSec + LOST_TIME_PER_PHASE_S } : {}),
    }
    : null;
  const timingModel: TimingModel = {
    current: timing,
    base: baseTiming,
    changed: plan.timingChanged,
    webster,
    websterInUse: sameWebster(timing, webster),
    lostTimePerPhaseS: LOST_TIME_PER_PHASE_S,
    splits,
  };

  // The sim runs the DRAWN row: with a scenario that is the scenario's own
  // timing (its signalTiming is the override the solve resolved) and volumes,
  // and it discharges at the weather-adjusted saturation flow the row's
  // capacity was sized with.
  const nobuild = simInputsFromRow(drawn, "nobuild", { weatherFactor });
  const build = simInputsFromRow(drawn, "build", { weatherFactor });
  // The printed delay carries the row's calibration multiplier; the sim is
  // uncalibrated, so the readout compares against the raw vcToDelay figure.
  const calibrationMultiplier = calibrationMultiplierOf(drawn);
  const engine = {} as SimModel["engine"];
  for (const d of DIRECTIONS) {
    const a = plan.approaches.find((x) => x.direction === d);
    const q = queuing.find((x) => x.direction === d);
    engine[d] = a && q
      ? {
        delay: { ...a.delay },
        delayUncalibrated: { noBuild: a.delay.noBuild / calibrationMultiplier, build: a.delay.build / calibrationMultiplier },
        q95Ft: { noBuild: q.q95NoBuildFt, build: q.q95Ft },
        los: { ...a.los },
      }
      : { delay: { noBuild: 0, build: 0 }, delayUncalibrated: { noBuild: 0, build: 0 }, q95Ft: { noBuild: 0, build: 0 }, los: { noBuild: "A", build: "A" } };
  }
  const sim: SimModel = {
    nobuild, build, engine, calibrationMultiplier, weatherFactor, scenario,
    agreementBand: SIM_AGREEMENT_BAND, agreementConditions: SIM_AGREEMENT_CONDITIONS,
  };

  const whatIf: WhatIfModel = {
    edit: timingEditFromRow(drawn),
    timing: drawn.signalTiming,
    baseCycleLenSec: row.signalTiming?.cycleLenSec,
  };

  const mitigation: MitigationModel = {
    severity: verdict.severity,
    mitigation: verdict.mitigation,
    ...(baseVerdict ? { base: { severity: baseVerdict.severity, mitigation: baseVerdict.mitigation } } : {}),
    turboLane: drawn.turboLane && typeof drawn.turboLane === "object" ? (drawn.turboLane as Record<string, unknown>) : null,
    turboScreened: !!drawn.turboScreenInputs,
    methodNotes: methodNotes(drawn, plan, build, weatherFactor),
  };

  return {
    signalId: drawn.signalId,
    name: drawn.name,
    zone: drawn.zone,
    distanceMi: num(drawn.distanceMi),
    scenario,
    summary,
    plan,
    queuing,
    timing: timingModel,
    sim,
    whatIf,
    mitigation,
    sections: SECTIONS,
  };
}
