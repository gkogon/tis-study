/**
 * Hand-written Zod schemas for the Parking Demand Study endpoint.
 *
 * Kept separate from `generated/` so orval regenerations of the TIS
 * surface don't clobber them. When the Parking endpoint stabilizes,
 * promote these to `openapi.yaml` and re-run `pnpm --filter
 * @workspace/tis-api-spec run codegen` — then delete this file.
 */
import * as zod from "zod";

// ---------- Land-use registry (ITE Parking Generation 5th Ed.) ----------

export const ParkingLandUse = zod.object({
  code: zod.string(),
  name: zod.string(),
  unit: zod.string(),
  unitShort: zod.string(),
  // Average peak parking demand per unit, weekday.
  weekdayPeakRate: zod.number(),
  // Average peak parking demand per unit, Saturday.
  saturdayPeakRate: zod.number(),
  // Local code (City of Atlanta default) minimum per unit. Engineers
  // override per-jurisdiction in the request.
  codeMinPerUnit: zod.number(),
});

export type ParkingLandUseT = zod.infer<typeof ParkingLandUse>;

export const ListParkingLandUsesResponse = zod.array(ParkingLandUse);

// ---------- Request ----------

export const GenerateParkingBody = zod.object({
  projectName: zod.string().min(1).max(200),
  address: zod.string().max(200).optional(),
  // Atlanta MSA bounding box; same as TIS for consistency.
  latitude: zod.number().min(33.4).max(34.2).optional(),
  longitude: zod.number().min(-84.9).max(-83.9).optional(),
  landUseCode: zod.string().min(2),
  size: zod.number().min(0.01),
  // Optional jurisdictional override of the code minimum (e.g. Fulton
  // County requires more spaces per DU than the City of Atlanta).
  codeMinOverridePerUnit: zod.number().min(0).max(20).optional(),
  // Proposed parking supply the engineer is testing.
  proposedSpaces: zod.number().int().min(0),
  // Optional shared-use reduction (mixed-use sites can share parking
  // between complementary uses per ULI Shared Parking 3rd Ed.).
  sharedUseReductionPct: zod.number().min(0).max(40).optional(),
});

export type GenerateParkingBodyT = zod.infer<typeof GenerateParkingBody>;

// ---------- Response ----------

const Verdict = zod.enum(["surplus", "match", "deficit"]);

export const GenerateParkingResponse = zod.object({
  projectName: zod.string(),
  landUse: zod.object({
    code: zod.string(),
    name: zod.string(),
    unit: zod.string(),
  }),
  size: zod.number(),
  demand: zod.object({
    weekdayPeak: zod.number(),
    saturdayPeak: zod.number(),
    governingDemand: zod.number(),
    governingPeriod: zod.enum(["weekday", "saturday"]),
    // After shared-use reduction (if any).
    adjustedDemand: zod.number(),
    sharedUseReductionPct: zod.number(),
  }),
  codeRequired: zod.object({
    perUnit: zod.number(),
    total: zod.number(),
    source: zod.enum(["city_of_atlanta_default", "user_override"]),
  }),
  proposedSpaces: zod.number().int(),
  // ITE vs code: engineers cite the higher of the two as governing.
  iteVerdict: Verdict,
  codeVerdict: Verdict,
  // Surplus (+) or deficit (-) under the governing comparison.
  governingDelta: zod.number().int(),
  // Per-period table for the report.
  hourlyProfileWeekday: zod.array(
    zod.object({ hour: zod.number().int().min(0).max(23), demand: zod.number() }),
  ),
  hourlyProfileSaturday: zod.array(
    zod.object({ hour: zod.number().int().min(0).max(23), demand: zod.number() }),
  ),
  citations: zod.array(zod.string()),
});

export type GenerateParkingResponseT = zod.infer<typeof GenerateParkingResponse>;
