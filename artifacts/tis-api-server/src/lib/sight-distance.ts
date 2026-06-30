/**
 * Sight Distance engine (standard AASHTO-procedure SSD / ISD).
 *
 * Implements the two checks engineers run during a driveway-location or
 * intersection-feasibility study. The methods follow the standard AASHTO
 * SSD/ISD procedure (the equations are uncopyrightable); the specific
 * time-gap VALUES are taken from the FREE, public TxDOT Roadway Design
 * Manual §13-5 (Tables 13-2 / 13-3), which restates the standard ISD
 * gap-time criteria — NOT reproduced from the licensed AASHTO Green Book.
 *
 *   Stopping Sight Distance (SSD):
 *     SSD = 1.47 · V · t + V² / (30 · (a/g ± G))
 *   where V = mph, t = perception-reaction (s), a/g = friction (default
 *   0.35 from 11.2 ft/s²), G = grade as decimal. Returns feet.
 *
 *   Intersection Sight Distance (ISD):
 *     ISD = 1.47 · V_major · t_gap
 *   where t_gap is the base passenger-car time gap (TxDOT RDM §13-5:
 *   7.5 s left, 6.5 s right, 6.5 s crossing), plus a per-additional-lane
 *   increment of 0.5 s (passenger car) / 0.7 s (truck) for each lane the
 *   minor driver must cross.
 *
 *   Truck adjustment — TxDOT RDM §13-5 (Tables 13-2/13-3): the design-vehicle
 *   gap adds +2.0 s (single-unit) / +4.0 s (combination) to the passenger-car
 *   gap. This adder is UNIFORM across maneuver (only the base gap varies by
 *   maneuver), so a single per-class constant is exact. Left turn: 7.5/9.5/11.5
 *   s; right & crossing: 6.5/8.5/10.5 s (passenger / single-unit / combination).
 */
import type {
  GenerateSightDistanceBodyT,
  GenerateSightDistanceResponseT,
} from "@workspace/tis-api-zod";

const DEFAULT_PR_TIME_SEC = 2.5;
const DEFAULT_DECEL_FT_S2 = 11.2;
const G_FT_S2 = 32.2;

// Base passenger-car ISD time gaps (s) — TxDOT Roadway Design Manual
// §13-5, Tables 13-2/13-3 (a free public restatement of the standard
// ISD gap-time criteria; not reproduced from the licensed AASHTO Green Book).
const TIME_GAP_BASE_SEC: Record<string, number> = {
  left_from_minor: 7.5,
  right_from_minor: 6.5,
  crossing_from_minor: 6.5,
};

// Design-vehicle time-gap adders (s), added to the base passenger-car gap —
// TxDOT Roadway Design Manual §13-5, Tables 13-2/13-3 (a free public restatement
// of the standard Case-B ISD criteria; not reproduced from the licensed AASHTO
// Green Book). The adder is the same for every maneuver — left turn 7.5→9.5→11.5
// s, right/crossing 6.5→8.5→10.5 s — so a single per-class constant is exact;
// only the base gap (above) is per-maneuver.
const VEHICLE_TIME_GAP_ADD_SEC: Record<string, number> = {
  passenger_car: 0,
  single_unit_truck: 2.0,
  combination_truck: 4.0,
};

// TxDOT RDM §13-5 multilane adjustment: time added per ADDITIONAL through lane
// the minor-road driver must cross — 0.5 s for passenger cars, 0.7 s for trucks.
const LANE_ADD_PER_LANE_SEC = { passenger_car: 0.5, truck: 0.7 } as const;

export class SightDistanceEngineError extends Error {}

export function runSightDistanceAnalysis(
  body: GenerateSightDistanceBodyT,
): GenerateSightDistanceResponseT {
  const speed = body.majorStreet.designSpeedMph;
  const prTime = body.perceptionReactionSec ?? DEFAULT_PR_TIME_SEC;
  const decel = body.decelerationFtPerSec2 ?? DEFAULT_DECEL_FT_S2;
  const grade = (body.majorStreet.approachGradePct ?? 0) / 100;
  const lanesToCross = body.minorStreet.lanesToCross ?? 0;
  const vehicleClass = body.vehicleClass ?? "passenger_car";

  // ---------- SSD ----------
  // Use the friction-grade form so the grade affects braking distance.
  // f = a/g; effective friction = f ± grade. AASHTO uses brake-only and
  // ignores grade contribution to driver perception time.
  const fEffective = decel / G_FT_S2 + grade;
  // Guard against negative friction (would happen at extreme downgrade
  // with low deceleration). AASHTO caps SSD at a sane upper bound.
  const fSafe = Math.max(fEffective, 0.05);
  const reactionDistanceFt = 1.47 * speed * prTime;
  const brakingDistanceFt = (speed * speed) / (30 * fSafe);
  const ssdRequiredFt = Math.round(reactionDistanceFt + brakingDistanceFt);

  const ssdAvail = body.availableSsdFt ?? null;
  const ssdVerdict = verdictOf(ssdAvail, ssdRequiredFt);
  const ssdMargin = ssdAvail !== null ? ssdAvail - ssdRequiredFt : null;
  const ssdNotes: string[] = [];
  ssdNotes.push(
    `Reaction component: ${Math.round(reactionDistanceFt)} ft over ${prTime.toFixed(1)} s of perception-reaction.`,
  );
  ssdNotes.push(
    `Braking component: ${Math.round(brakingDistanceFt)} ft assuming ${decel.toFixed(1)} ft/s² deceleration${grade !== 0 ? ` and ${(grade * 100).toFixed(1)}% grade` : ""}.`,
  );
  if (ssdAvail === null) {
    ssdNotes.push("No measured SSD provided. Use a field walkthrough or design drawings to verify.");
  } else if (ssdVerdict === "fail") {
    ssdNotes.push(`Deficit of ${Math.abs(ssdMargin ?? 0)} ft. Consider lowering speed limit, removing the obstruction, or relocating the intersection / driveway.`);
  } else if (ssdVerdict === "marginal") {
    ssdNotes.push(`Within 10% of the requirement. A small change in vegetation, vehicle stacking, or grade could push it below standard.`);
  }

  // ---------- ISD ----------
  const baseGap = TIME_GAP_BASE_SEC[body.maneuver] ?? 6.5;
  const vehicleAdd = VEHICLE_TIME_GAP_ADD_SEC[vehicleClass] ?? 0;
  const isTruck =
    vehicleClass === "single_unit_truck" || vehicleClass === "combination_truck";
  const perLaneSec = isTruck ? LANE_ADD_PER_LANE_SEC.truck : LANE_ADD_PER_LANE_SEC.passenger_car;
  const laneAdd = perLaneSec * lanesToCross;
  const isdTimeGap = baseGap + vehicleAdd + laneAdd;
  const isdRequiredFt = Math.round(1.47 * speed * isdTimeGap);

  const isdAvail = body.availableIsdFt ?? null;
  const isdVerdict = verdictOf(isdAvail, isdRequiredFt);
  const isdMargin = isdAvail !== null ? isdAvail - isdRequiredFt : null;
  const isdNotes: string[] = [];
  isdNotes.push(
    `Time-gap criterion: ${isdTimeGap.toFixed(1)} s — base ${baseGap.toFixed(1)} s for ${labelManeuver(body.maneuver)}${vehicleAdd > 0 ? ` plus ${vehicleAdd.toFixed(1)} s ${labelVehicle(vehicleClass)} adjustment` : ""}${laneAdd > 0 ? ` plus ${laneAdd.toFixed(1)} s for ${lanesToCross} additional lane${lanesToCross === 1 ? "" : "s"} to cross (${perLaneSec.toFixed(1)} s/lane)` : ""}.`,
  );
  if (isdAvail === null) {
    isdNotes.push("No measured ISD provided. Stand at the minor-approach decision point with a steel tape or wheel and measure to the first obstruction.");
  } else if (isdVerdict === "fail") {
    isdNotes.push(`Deficit of ${Math.abs(isdMargin ?? 0)} ft. Mitigations: prohibit the deficient movement, install a yield-controlled all-way stop with full clear zones, or relocate the access point.`);
  } else if (isdVerdict === "marginal") {
    isdNotes.push("Within 10% of the requirement. Re-verify after any landscape change or seasonal foliage growth.");
  }

  return {
    projectName: body.projectName,
    intersection: {
      name: body.intersectionName ?? `${body.majorStreet.name} @ ${body.minorStreet.name}`,
      major: body.majorStreet.name,
      minor: body.minorStreet.name,
      designSpeedMph: speed,
    },
    inputs: {
      maneuver: body.maneuver,
      vehicleClass,
      perceptionReactionSec: prTime,
      decelerationFtPerSec2: decel,
      approachGradePct: (body.majorStreet.approachGradePct ?? 0),
      lanesToCross,
    },
    ssd: {
      requiredFt: ssdRequiredFt,
      availableFt: ssdAvail,
      verdict: ssdVerdict,
      marginFt: ssdMargin,
      notes: ssdNotes,
    },
    isd: {
      requiredFt: isdRequiredFt,
      availableFt: isdAvail,
      verdict: isdVerdict,
      marginFt: isdMargin,
      timeGapSec: round1(isdTimeGap),
      notes: isdNotes,
    },
    citations: [
      "TxDOT Roadway Design Manual §13-5 (Tables 13-2/13-3) — free, public restatement of the standard intersection sight distance criteria used here; not reproduced from the licensed AASHTO Green Book.",
      "Stopping Sight Distance: SSD = 1.47·V·t + V²/(30·(a/g ± G)) — the standard perception-reaction-plus-braking-distance equation, which is uncopyrightable.",
      "TxDOT Roadway Design Manual §13-5 (Tables 13-2/13-3) — base intersection-sight-distance time gaps (left 7.5 s; right & crossing 6.5 s) plus the per-additional-lane increment of +0.5 s (passenger car) / +0.7 s (truck).",
      "TxDOT Roadway Design Manual §13-5 (Tables 13-2/13-3) — design-vehicle gap adders relative to the passenger-car gap: +2.0 s (single-unit truck) / +4.0 s (combination truck).",
    ],
  };
}

function verdictOf(available: number | null, required: number): "pass" | "marginal" | "fail" | "not_measured" {
  if (available === null) return "not_measured";
  if (available >= required) return "pass";
  if (available >= required * 0.9) return "marginal";
  return "fail";
}

function labelManeuver(m: string): string {
  switch (m) {
    case "left_from_minor": return "left turn from minor";
    case "right_from_minor": return "right turn from minor";
    case "crossing_from_minor": return "crossing from minor";
    default: return m;
  }
}

function labelVehicle(v: string): string {
  switch (v) {
    case "passenger_car": return "passenger-car";
    case "single_unit_truck": return "single-unit truck";
    case "combination_truck": return "combination truck";
    default: return v;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
