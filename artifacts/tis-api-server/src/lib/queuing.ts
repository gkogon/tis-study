/**
 * HCM 6th Ed. Chapter 31 — Signalized Intersections, 95th-percentile
 * back-of-queue engine (screening fidelity).
 *
 * Formulae:
 *   Capacity per lane         c_l = s × g / C            (HCM 19-8)
 *   v/c ratio                 X   = v / c
 *   Average queue at end of red:
 *     Q_avg = v × (C − g) / 3600       (vehicles)
 *   95th-percentile multiplier:
 *     Under-saturated (X ≤ 0.85): k = 1.65
 *     Approaching capacity (0.85 < X < 1.0): k = 1.65 + 1.5 × (X − 0.85)/0.15
 *     Over-saturated (X ≥ 1.0): k = 3.0 plus a queue-growth term
 *       Q_grow = (v − c) × T          (additional vehicles per analysis period)
 *
 *   Q_95 in feet = Q_95 vehicles × vehicle spacing.
 *
 * For full HCM rigor (random arrival, progression-quality PF, incremental
 * delay d2 and oversaturation queue growth), engineers run HCS / Synchro.
 * This engine is a defensible screening estimate.
 */
import type {
  GenerateQueuingBodyT,
  GenerateQueuingResponseT,
} from "@workspace/tis-api-zod";

const DEFAULT_SAT_FLOW_THROUGH = 1900;
const DEFAULT_SAT_FLOW_LEFT = 1805;
const DEFAULT_SAT_FLOW_RIGHT = 1615;
const DEFAULT_VEHICLE_SPACING_FT = 25;
const DEFAULT_ANALYSIS_HR = 0.25;

function defaultSatFlow(movement: "through" | "left_turn" | "right_turn"): number {
  switch (movement) {
    case "through": return DEFAULT_SAT_FLOW_THROUGH;
    case "left_turn": return DEFAULT_SAT_FLOW_LEFT;
    case "right_turn": return DEFAULT_SAT_FLOW_RIGHT;
  }
}

export class QueuingEngineError extends Error {}

export function runQueuingAnalysis(
  body: GenerateQueuingBodyT,
): GenerateQueuingResponseT {
  const sat = body.saturationFlowVphpl ?? defaultSatFlow(body.movement);
  const C = body.cycleLengthSec;
  const g = body.effectiveGreenSec;
  if (g >= C) {
    throw new QueuingEngineError("Effective green must be less than cycle length.");
  }
  const T = body.analysisPeriodHr ?? DEFAULT_ANALYSIS_HR;
  const spacing = body.vehicleSpacingFt ?? DEFAULT_VEHICLE_SPACING_FT;

  const perLaneCapacity = sat * (g / C);
  const totalCapacity = perLaneCapacity * body.laneCount;
  const X = body.hourlyVolumeVph / Math.max(totalCapacity, 1);
  const isOversaturated = X >= 1.0;

  // Average queue at end of red, vehicles (across all lanes summed; per-lane
  // would divide; we keep total for the storage check to be conservative).
  const Q_avg = (body.hourlyVolumeVph * (C - g)) / 3600;

  // 95th-percentile multiplier.
  let k: number;
  if (X <= 0.85) {
    k = 1.65;
  } else if (X < 1.0) {
    k = 1.65 + 1.5 * ((X - 0.85) / 0.15);
  } else {
    k = 3.0;
  }
  let Q_95 = Q_avg * k;
  if (isOversaturated) {
    // Add queue-growth from sustained over-demand over the analysis period.
    const excessDemand = body.hourlyVolumeVph - totalCapacity;
    const Q_grow = (excessDemand * T);
    Q_95 += Q_grow;
  }

  // Storage check — back-of-queue per the most-loaded lane. We use the
  // per-lane queue (Q_95 / lanes) because storage is per-lane, but compare
  // conservatively against the full-lane storage (most engineers report
  // queue per-lane).
  const Q_95_perLane = Q_95 / body.laneCount;
  const Q_avg_perLane = Q_avg / body.laneCount;
  const requiredFt = Math.ceil(Q_95_perLane * spacing);

  const availableFt = body.availableStorageFt ?? null;
  const verdict = verdictOf(availableFt, requiredFt);
  const marginFt = availableFt !== null ? availableFt - requiredFt : null;

  const notes: string[] = [];
  notes.push(
    `Capacity ${Math.round(perLaneCapacity)} vph/lane × ${body.laneCount} lanes = ${Math.round(totalCapacity)} vph total.`,
  );
  notes.push(
    `v/c ratio ${X.toFixed(2)}${isOversaturated ? " — oversaturated; queue grows each cycle until demand subsides." : ""}.`,
  );
  notes.push(
    `95th-percentile multiplier k = ${k.toFixed(2)} (${X <= 0.85 ? "under-capacity" : X < 1.0 ? "approaching capacity" : "over-saturated"}).`,
  );
  if (availableFt === null) {
    notes.push("No measured storage provided — required length is the recommendation.");
  } else if (verdict === "fail") {
    notes.push(
      `Auxiliary lane is ${Math.abs(marginFt ?? 0)} ft short. Lengthen the bay or reduce demand (signal retiming, lane reassignment, access management).`,
    );
  } else if (verdict === "marginal") {
    notes.push("Within 10% of the requirement. Margin will erode under heavier days or progression failures.");
  }
  notes.push(
    "Screening estimate. A full HCM Ch. 31 analysis runs incremental-delay (d2) and progression-quality (PF) terms — use HCS or Synchro for the final design.",
  );

  return {
    projectName: body.projectName,
    intersection: {
      name: body.intersectionName ?? `${body.approachStreet} approach`,
      approach: body.approachStreet,
      movement: body.movement,
    },
    inputs: {
      hourlyVolumeVph: body.hourlyVolumeVph,
      laneCount: body.laneCount,
      cycleLengthSec: body.cycleLengthSec,
      effectiveGreenSec: body.effectiveGreenSec,
      saturationFlowVphpl: sat,
      vehicleSpacingFt: spacing,
      analysisPeriodHr: T,
    },
    capacity: {
      perLaneVph: Math.round(perLaneCapacity),
      totalVph: Math.round(totalCapacity),
      vOverC: round2(X),
      isOversaturated,
    },
    queue: {
      averageVehicles: round1(Q_avg_perLane),
      averageFt: Math.ceil(Q_avg_perLane * spacing),
      p95Vehicles: round1(Q_95_perLane),
      p95Ft: requiredFt,
    },
    storage: {
      availableFt,
      verdict,
      marginFt,
      requiredFt,
    },
    notes,
    citations: [
      "HCM 6th Edition Chapter 31 — Signalized Intersections: Supplemental.",
      "HCM Eq. 19-8 — Capacity of a signalized lane group.",
      "HCM Eq. 31-6 — Queue length and storage ratio.",
    ],
  };
}

function verdictOf(available: number | null, required: number) {
  if (available === null) return "not_measured" as const;
  if (available >= required) return "pass" as const;
  if (available >= required * 0.9) return "marginal" as const;
  return "fail" as const;
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }
