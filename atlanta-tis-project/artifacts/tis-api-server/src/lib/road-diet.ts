/**
 * Road-Diet Feasibility Screening engine.
 *
 * Based on FHWA-SA-14-028 ("Road Diet Informational Guide"):
 *   - 4-to-3 conversion (most common): typically feasible up to ~25,000
 *     ADT for two-way operations. Above 25,000 individual-corridor study
 *     is required.
 *   - Average safety reduction across the corpus of studies: 19–47 %
 *     (FHWA reports a mean of 29 %).
 *   - 5-to-3 conversion: similar capacity envelope; safety lift smaller
 *     because the parent 5-lane already had a center turn lane.
 *
 * The screening verdict considers ADT, peak-hour v/c against the
 * proposed config's lane capacity, posted speed, and presence of
 * complicating factors (freight route, transit, on-street parking).
 */
import type {
  GenerateRoadDietBodyT,
  GenerateRoadDietResponseT,
} from "@workspace/tis-api-zod";

// Per-direction through-lane capacity at LOS C/D, vehicles/hour.
// Conservative HCM defaults for urban arterial signalized operations.
const LANE_CAPACITY_VPH: Record<string, number> = {
  "4_lane_undivided": 1700,
  "4_lane_divided": 1750,
  "5_lane_with_twltl": 1700,
  "3_lane_with_twltl": 1700,
  "2_lane": 1500,
};
// Through lanes per direction by configuration.
const THROUGH_LANES_PER_DIR: Record<string, number> = {
  "4_lane_undivided": 2,
  "4_lane_divided": 2,
  "5_lane_with_twltl": 2,
  "3_lane_with_twltl": 1,
  "2_lane": 1,
};

export class RoadDietEngineError extends Error {}

export function runRoadDietAnalysis(
  body: GenerateRoadDietBodyT,
): GenerateRoadDietResponseT {
  const proposedConfig = body.proposedConfig;
  const currentConfig = body.currentConfig;
  const lanesPerDirProposed = THROUGH_LANES_PER_DIR[proposedConfig] ?? 1;
  const perLaneCap = LANE_CAPACITY_VPH[proposedConfig] ?? 1700;
  const dirSplit = body.directionalSplit ?? 0.55;
  const phf = body.peakHourFactor ?? 0.92;

  // Approximate the peak hour from ADT if not given (typical urban: K=8.5%).
  const peakHourVph = body.peakHourVph ?? Math.round(body.adt * 0.085);
  const peakDirVph = Math.round((peakHourVph * dirSplit) / Math.max(phf, 0.7));

  const proposedDirCapacity = perLaneCap * lanesPerDirProposed;
  const vOverC = peakDirVph / Math.max(proposedDirCapacity, 1);
  const headroom =
    vOverC <= 0.7 ? "ample" :
    vOverC <= 0.85 ? "comfortable" :
    vOverC <= 0.95 ? "tight" :
    vOverC <= 1.0 ? "at-capacity" : "over-capacity";

  // Safety — FHWA-tracked mean reduction for 4-to-3 conversions.
  const is4to3 = (currentConfig === "4_lane_undivided" || currentConfig === "4_lane_divided")
              && proposedConfig === "3_lane_with_twltl";
  const is5to3 = currentConfig === "5_lane_with_twltl" && proposedConfig === "3_lane_with_twltl";
  const estimatedReductionPct = is4to3 ? 29 : is5to3 ? 15 : 10;
  const estimatedCrashesPrevented =
    body.crashCount12mo !== undefined
      ? Math.round(body.crashCount12mo * (estimatedReductionPct / 100))
      : null;

  // Multimodal benefits.
  const multimodal: string[] = [];
  if (is4to3 || is5to3) {
    multimodal.push("Frees enough width for buffered bike lanes (4–7 ft each side, plus 2-ft buffer).");
    multimodal.push("Shortens pedestrian crossing distance by the width of one travel lane (~12 ft).");
  }
  if (body.hasOnstreetParking) {
    multimodal.push("On-street parking can be preserved or formalized with proper offset clearance.");
  }
  if (!body.hasBikeAccommodations && (is4to3 || is5to3)) {
    multimodal.push("Add bike lanes during striping work to maximize the safety and modeshare lift.");
  }

  // Overall feasibility.
  const reasoning: string[] = [];
  let verdict: GenerateRoadDietResponseT["overall"]["verdict"] = "feasible_with_caveats";
  if (is4to3 && body.adt <= 20_000 && vOverC <= 0.85 && body.postedSpeedMph <= 45) {
    verdict = "highly_feasible";
    reasoning.push(`ADT ${body.adt.toLocaleString()} is well below the 25,000 FHWA screening threshold.`);
    reasoning.push(`Peak-hour v/c of ${vOverC.toFixed(2)} on the proposed config leaves comfortable headroom.`);
  } else if (is4to3 && body.adt > 25_000) {
    verdict = "not_recommended";
    reasoning.push(`ADT ${body.adt.toLocaleString()} exceeds the 25,000 FHWA screening threshold for 4-to-3 conversions; full corridor study required.`);
  } else if (vOverC > 1.0) {
    verdict = "not_recommended";
    reasoning.push(`Peak-hour v/c of ${vOverC.toFixed(2)} on the proposed config exceeds capacity — conversion would create unacceptable congestion.`);
  } else if (vOverC > 0.9) {
    verdict = "marginal";
    reasoning.push(`Peak-hour v/c of ${vOverC.toFixed(2)} on the proposed config is tight; minor demand growth would push over capacity.`);
  } else if (is4to3 && body.adt <= 25_000) {
    verdict = "feasible_with_caveats";
    reasoning.push(`Within FHWA's 25,000 ADT screening threshold; peak-hour v/c ${vOverC.toFixed(2)} is workable.`);
  }
  if (body.hasFreightRoute) {
    reasoning.push("Designated freight route — confirm truck turning paths on the proposed cross-section before commitment.");
    if (verdict === "highly_feasible") verdict = "feasible_with_caveats";
  }
  if (body.postedSpeedMph > 45) {
    reasoning.push("Posted speed > 45 mph — road diets perform best at 40 mph or below. Consider a speed-management element with the conversion.");
    if (verdict === "highly_feasible") verdict = "feasible_with_caveats";
  }
  if (!is4to3 && !is5to3) {
    reasoning.push("Conversion is outside the FHWA-documented 4-to-3 / 5-to-3 family; engineering judgment dominates.");
  }

  return {
    projectName: body.projectName,
    corridor: {
      name: body.corridorName ?? body.projectName,
      currentConfig,
      proposedConfig,
      adt: body.adt,
      postedSpeedMph: body.postedSpeedMph,
    },
    capacity: {
      proposedCapacityVph: proposedDirCapacity,
      projectedPeakHourVph: peakDirVph,
      vOverC: round2(vOverC),
      headroom,
    },
    safety: {
      baselineCrashes12mo: body.crashCount12mo ?? null,
      estimatedReductionPct,
      estimatedCrashesPrevented,
    },
    multimodal,
    overall: { verdict, reasoning },
    citations: [
      "FHWA-SA-14-028 — Road Diet Informational Guide.",
      "FHWA Proven Safety Countermeasures: Road Diets.",
      "HCM 6th Ed. Ch. 18 — Urban Street Segments (capacity reference).",
    ],
  };
}

function round2(n: number) { return Math.round(n * 100) / 100; }
