/**
 * Hand-written Zod schemas for Road-Diet Feasibility Screening.
 *
 * Most common conversion: 4-lane undivided → 3-lane with TWLTL
 * (two-way left-turn lane). FHWA "Road Diet Informational Guide"
 * (FHWA-SA-14-028) is the source of the 25,000 ADT screening
 * threshold and the typical 19–47% crash reduction range (mean ~29%).
 */
import * as zod from "zod";

const Config = zod.enum([
  "4_lane_undivided",
  "4_lane_divided",
  "5_lane_with_twltl",
  "3_lane_with_twltl",
  "2_lane",
]);

export const GenerateRoadDietBody = zod.object({
  projectName: zod.string().min(1).max(200),
  corridorName: zod.string().max(200).optional(),
  latitude: zod.number().min(33.4).max(34.2).optional(),
  longitude: zod.number().min(-84.9).max(-83.9).optional(),

  currentConfig: Config,
  proposedConfig: Config,

  adt: zod.number().min(500).max(80000),
  peakHourVph: zod.number().min(50).max(8000).optional(),
  peakHourFactor: zod.number().min(0.7).max(1.0).optional(),
  directionalSplit: zod.number().min(0.5).max(0.85).optional(),

  postedSpeedMph: zod.number().min(15).max(60),

  // Last 12 months of crashes within the corridor segment.
  crashCount12mo: zod.number().int().min(0).max(500).optional(),

  // Engineering judgment toggles.
  hasOnstreetParking: zod.boolean().optional(),
  hasBikeAccommodations: zod.boolean().optional(),
  hasFreightRoute: zod.boolean().optional(),
});

export type GenerateRoadDietBodyT = zod.infer<typeof GenerateRoadDietBody>;

const Verdict = zod.enum(["highly_feasible", "feasible_with_caveats", "marginal", "not_recommended"]);

export const GenerateRoadDietResponse = zod.object({
  projectName: zod.string(),
  corridor: zod.object({
    name: zod.string(),
    currentConfig: Config,
    proposedConfig: Config,
    adt: zod.number(),
    postedSpeedMph: zod.number(),
  }),
  capacity: zod.object({
    proposedCapacityVph: zod.number(),
    projectedPeakHourVph: zod.number(),
    vOverC: zod.number(),
    headroom: zod.string(),
  }),
  safety: zod.object({
    baselineCrashes12mo: zod.number().nullable(),
    estimatedReductionPct: zod.number(),
    estimatedCrashesPrevented: zod.number().nullable(),
  }),
  multimodal: zod.array(zod.string()),
  overall: zod.object({
    verdict: Verdict,
    reasoning: zod.array(zod.string()),
  }),
  citations: zod.array(zod.string()),
});

export type GenerateRoadDietResponseT = zod.infer<typeof GenerateRoadDietResponse>;
