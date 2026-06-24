/**
 * Turbo-lane (continuous-green-T) screening.
 *
 * A turbo lane is a continuous-green treatment at a signalized 3-leg
 * T-intersection: one or more main-street through lanes flow continuously
 * (effective g/C ≈ 1.0) while the minor-street left turn merges into a lane
 * built in the median. The capacity benefit — per Miami-Dade MPO / David
 * Plummer & Associates, "Adding Turbo Lanes to T-Intersections" (2010), and
 * FDOT District 6, "Design Guidelines for the Development of Continuous Green
 * Intersections" (1997) — is purely the recovered green time:
 *
 *     capacityGain% = (N_turbo / N_lanes) · (1 − g/C) / (g/C)
 *
 * which captures the study's three drivers (approach lanes, turbo lanes, the
 * existing through-green ratio) and its observed +7%…+173% envelope. The gain
 * is larger when the main street's existing green share is lower — exactly what
 * the Webster-derived g/C below reproduces.
 *
 * This module is region-agnostic: it runs inside the shared engine so every
 * study (all metros) inherits turbo-lane screening, not just Miami-Dade.
 */
import { vcToDelay, delayToLos, queue95Ft, type Los, type Direction } from "./tis";

/** Fallback main-street through g/C when the minor-approach volume is unknown. */
export const TURBO_MAIN_STREET_GREEN_RATIO = 0.6;
/** Plausible clamp on the derived main-street through g/C. */
export const TURBO_GREEN_MIN = 0.45;
export const TURBO_GREEN_MAX = 0.8;
/** Study-observed approach-capacity-gain envelope (Appendix G: 7%–173%). */
export const TURBO_GAIN_MIN = 0.07;
export const TURBO_GAIN_MAX = 1.73;
/** HCM through-movement saturation flow (vehicles / hour / lane). */
const SATURATION_FLOW_VPH = 1800;
/** Arterial-or-better classes a turbo lane is appropriate for. */
const ARTERIAL_CLASSES = new Set(["motorway", "trunk", "primary", "secondary"]);

/** Approach ORIGIN bearings (deg from N): the compass direction a driver on
 *  that approach is coming FROM. Mirrors tis.ts APPROACH_ORIGIN_BEARING and is
 *  the same convention as a leg's node→leg-end bearing. */
const APPROACH_ORIGIN_BEARING: Record<Direction, number> = { NB: 180, SB: 0, EB: 270, WB: 90 };
const DIRECTIONS: Direction[] = ["NB", "SB", "EB", "WB"];

/** The analyzer-supplied geometry the screen consumes (subset of AnalyzerIntersection). */
export type TurboGeomInput = {
  roadClass?: string;
  legCount?: number;
  minorLegBearing?: number | null;
  medianType?: "raised" | "painted" | "none";
  mainThroughLanes?: number;
  mainThroughLanesMeasured?: boolean;
};

export type TurboInputProvenance = "measured" | "derived" | "default";

/** Result attached to an AffectedIntersection when it screens as a turbo candidate. */
export type TurboLaneScreening = {
  candidate: true;
  /** Recommended configuration type (A/B full, C/D partial). */
  turboType: "A" | "B" | "C" | "D";
  /** Main-street through movement that would run continuously. */
  turboDirection: Direction;
  /** Minor (stem) approach of the T. */
  minorLegDirection: Direction;
  medianType: "raised" | "painted";
  approachLanes: number;
  turboLanes: number;
  /** Main-street through g/C used (measured-derived or fallback). */
  throughGreenRatio: number;
  /** % approach-capacity improvement (clamped to the study envelope). */
  capacityGainPct: number;
  baselineApproachVc: number;
  mitigatedApproachVc: number;
  baselineApproachDelaySec: number;
  mitigatedApproachDelaySec: number;
  baselineApproachLos: Los;
  mitigatedApproachLos: Los;
  baselineApproachQueueFt: number;
  mitigatedApproachQueueFt: number;
  provenance: {
    median: TurboInputProvenance;
    greenRatio: TurboInputProvenance;
    lanes: TurboInputProvenance;
  };
  note: string;
};

/** Candidacy decision + the geometry needed to size the screening. */
export type TurboCandidate = {
  minorLegDirection: Direction;
  /** The two main-street through directions (opposed pair). */
  mainStreetDirections: [Direction, Direction];
  medianType: "raised" | "painted";
  approachLanes: number;
  lanesMeasured: boolean;
};

function isArterial(roadClass?: string): boolean {
  return roadClass !== undefined && ARTERIAL_CLASSES.has(roadClass);
}

function angDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Map a leg bearing (node→leg-end, ≡ approach origin bearing) to a cardinal approach. */
function cardinalFromLegBearing(bearing: number): Direction {
  let best: Direction = "NB";
  let bestD = 360;
  for (const d of DIRECTIONS) {
    const ad = angDiff(APPROACH_ORIGIN_BEARING[d], bearing);
    if (ad < bestD) { bestD = ad; best = d; }
  }
  return best;
}

/** Perpendicular axis to a given approach direction (the main street of an orthogonal T). */
function perpendicularPair(d: Direction): [Direction, Direction] {
  return d === "NB" || d === "SB" ? ["EB", "WB"] : ["NB", "SB"];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Decide whether a signal is a turbo-lane candidate. Returns null unless it is a
 * genuine 3-leg T (`legCount === 3`), on an arterial-or-better main street, with
 * a detected median — the physical prerequisites for the treatment.
 */
export function screenTurboCandidate(sig: TurboGeomInput): TurboCandidate | null {
  if (sig.legCount !== 3) return null;
  if (!isArterial(sig.roadClass)) return null;
  const median = sig.medianType;
  if (median !== "raised" && median !== "painted") return null;
  if (sig.minorLegBearing == null) return null;

  const minorLegDirection = cardinalFromLegBearing(sig.minorLegBearing);
  const mainStreetDirections = perpendicularPair(minorLegDirection);
  const lanesMeasured = sig.mainThroughLanesMeasured === true;
  const approachLanes = Math.max(1, sig.mainThroughLanes ?? 2);

  return { minorLegDirection, mainStreetDirections, medianType: median, approachLanes, lanesMeasured };
}

/** Derive the main-street through g/C from the modeled main-vs-minor volume split
 *  (Webster: green ∝ critical flow ratio). Falls back to the constant when the
 *  minor-approach volume is unavailable. */
export function deriveMainGreenRatio(mainThroughVph: number, minorApproachVph: number): {
  ratio: number;
  provenance: TurboInputProvenance;
} {
  if (!(minorApproachVph > 0) || !(mainThroughVph > 0)) {
    return { ratio: TURBO_MAIN_STREET_GREEN_RATIO, provenance: "default" };
  }
  const yMain = mainThroughVph / SATURATION_FLOW_VPH;
  const yMinor = minorApproachVph / SATURATION_FLOW_VPH;
  const raw = yMain / (yMain + yMinor);
  const ratio = Math.min(TURBO_GREEN_MAX, Math.max(TURBO_GREEN_MIN, raw));
  return { ratio, provenance: "derived" };
}

/**
 * Full turbo-lane screening for a candidate. `mainThroughVph` is the build-
 * condition volume on the turbo through approach; `minorApproachVph` is the
 * build-condition volume on the stem (used to derive the green split). `calMul`
 * is the engine's per-signal delay calibration multiplier.
 */
export function turboLaneScreening(
  cand: TurboCandidate,
  turboDirection: Direction,
  mainThroughVph: number,
  minorApproachVph: number,
  calMul: number,
): TurboLaneScreening {
  const lanes = cand.approachLanes;
  // Conservative: model a single continuous (turbo) lane. A single-lane main
  // street is inherently a full conversion; ≥2 lanes is a partial (Type C/D).
  const turboLanes = 1;
  const { ratio: gC, provenance: greenProv } = deriveMainGreenRatio(mainThroughVph, minorApproachVph);

  const baseCapacity = lanes * SATURATION_FLOW_VPH * gC;
  const turboCapacity = turboLanes * SATURATION_FLOW_VPH * 1.0 + (lanes - turboLanes) * SATURATION_FLOW_VPH * gC;

  // Capacity gain is saturation-flow-independent: (N_turbo/N_lanes)·(1−g/C)/(g/C).
  const rawGain = (turboLanes / lanes) * ((1 - gC) / gC);
  const capacityGainPct = Math.min(TURBO_GAIN_MAX, Math.max(TURBO_GAIN_MIN, rawGain)) * 100;

  const baseVc = mainThroughVph / baseCapacity;
  const mitVc = mainThroughVph / turboCapacity;
  // Conservative delay: treat the whole approach as signalized at the lower v/c.
  // The continuous lanes actually carry ~no control delay, so this is an upper bound.
  const baseDelay = vcToDelay(baseVc, baseCapacity) * calMul;
  const mitDelay = vcToDelay(mitVc, turboCapacity) * calMul;

  const median = cand.medianType;
  const turboType: TurboLaneScreening["turboType"] =
    lanes <= 1 ? "A" : median === "raised" ? "C" : "D";

  const lanesProv: TurboInputProvenance = cand.lanesMeasured ? "measured" : "default";
  const note =
    `Screening estimate. 3-leg T-geometry and ${median} median are detected from OpenStreetMap; ` +
    `main-street through g/C (${r2(gC)}) is ${greenProv === "derived" ? "derived from the modeled main-vs-minor volume split" : "a screening default"}. ` +
    `Per-direction through lanes (${lanes}) is a ${lanesProv === "measured" ? "measured" : "class-default"} value — ` +
    `confirm lane count and signal timing against field data before design. ` +
    (lanes >= 2
      ? `Modeled as a partial (Type ${turboType}) conversion of one through lane; a full Type A conversion of all ${lanes} lanes would increase the gain further.`
      : `Single through lane runs continuously (Type A).`);

  return {
    candidate: true,
    turboType,
    turboDirection,
    minorLegDirection: cand.minorLegDirection,
    medianType: median,
    approachLanes: lanes,
    turboLanes,
    throughGreenRatio: r2(gC),
    capacityGainPct: r1(capacityGainPct),
    baselineApproachVc: r2(baseVc),
    mitigatedApproachVc: r2(mitVc),
    baselineApproachDelaySec: r1(baseDelay),
    mitigatedApproachDelaySec: r1(mitDelay),
    baselineApproachLos: delayToLos(baseDelay),
    mitigatedApproachLos: delayToLos(mitDelay),
    // Per-lane 95th-pct queue (queue95Ft is a single-lane model): distribute
    // the approach volume and capacity across the through lanes so the queue
    // length is realistic and the before/after delta is meaningful.
    baselineApproachQueueFt: r1(queue95Ft(mainThroughVph / lanes, baseCapacity / lanes)),
    mitigatedApproachQueueFt: r1(queue95Ft(mainThroughVph / lanes, turboCapacity / lanes)),
    provenance: { median: "measured", greenRatio: greenProv, lanes: lanesProv },
    note,
  };
}
