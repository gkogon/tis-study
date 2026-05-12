/**
 * Hand-written Zod schemas for Signal Warrant Analysis (MUTCD Ch. 4C).
 *
 * Implements four most-commonly-cited warrants for the screening tier:
 *   1A — Eight-Hour Vehicular Volume, Condition A (Minimum Volume)
 *   1B — Eight-Hour Vehicular Volume, Condition B (Interruption)
 *    3 — Peak Hour (volume-only proxy from Fig. 4C-3)
 *    7 — Crash Experience
 *
 * Hours are 0..23. Volumes are total entering vehicles per hour on the
 * major street (sum both directions) and the minor approach (higher of
 * the two directions). This matches how MUTCD compares the data.
 */
import * as zod from "zod";

const LaneCount = zod.enum(["1", "2+"]);

const HourlyVolumes = zod.array(zod.number().min(0).max(20000)).length(24);

export const GenerateWarrantsBody = zod.object({
  projectName: zod.string().min(1).max(200),
  intersectionName: zod.string().max(200).optional(),
  latitude: zod.number().min(33.4).max(34.2).optional(),
  longitude: zod.number().min(-84.9).max(-83.9).optional(),

  majorStreet: zod.object({
    name: zod.string().max(120),
    lanesEachDirection: LaneCount,
    speed85thMph: zod.number().min(15).max(75),
  }),
  minorStreet: zod.object({
    name: zod.string().max(120),
    lanesEachDirection: LaneCount,
  }),

  // True if the major-street 85th-%ile speed exceeds 40 mph OR the
  // intersection is in an isolated community of <10,000 residents.
  // Engages the 70%-threshold reduction per MUTCD.
  applyReductionFactor: zod.boolean().optional(),

  hourlyVolumesMajor: HourlyVolumes,
  hourlyVolumesMinor: HourlyVolumes,

  // Last 12 months. Used for Warrant 7.
  crashCount12mo: zod.number().int().min(0).max(500).optional(),
});

export type GenerateWarrantsBodyT = zod.infer<typeof GenerateWarrantsBody>;

const WarrantOutcome = zod.object({
  id: zod.enum(["1A", "1B", "3", "7"]),
  name: zod.string(),
  description: zod.string(),
  met: zod.boolean(),
  hoursSatisfied: zod.number().int().min(0).max(24),
  hoursRequired: zod.number().int().min(0).max(24),
  // Detail rows for the report: which hours satisfied + thresholds used.
  hourBreakdown: zod.array(
    zod.object({
      hour: zod.number().int().min(0).max(23),
      majorVolume: zod.number(),
      minorVolume: zod.number(),
      majorThreshold: zod.number(),
      minorThreshold: zod.number(),
      majorMet: zod.boolean(),
      minorMet: zod.boolean(),
      bothMet: zod.boolean(),
    }),
  ),
  notes: zod.array(zod.string()),
});

export const GenerateWarrantsResponse = zod.object({
  projectName: zod.string(),
  intersection: zod.object({
    name: zod.string(),
    major: zod.string(),
    minor: zod.string(),
    laneConfig: zod.string(),
  }),
  reductionApplied: zod.boolean(),
  warrants: zod.array(WarrantOutcome),
  // Convenience for the report banner.
  anyWarrantMet: zod.boolean(),
  citations: zod.array(zod.string()),
});

export type GenerateWarrantsResponseT = zod.infer<typeof GenerateWarrantsResponse>;
