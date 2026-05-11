/**
 * Hand-written Zod schemas for the Queuing Analysis endpoint
 * (HCM 6th Ed. Ch. 31 — Signalized Intersections, 95th-percentile queue).
 *
 * Goal: tell the engineer whether the available auxiliary-lane storage
 * is long enough to contain the 95th-percentile back-of-queue.
 */
import * as zod from "zod";

const Movement = zod.enum(["through", "left_turn", "right_turn"]);

export const GenerateQueuingBody = zod.object({
  projectName: zod.string().min(1).max(200),
  intersectionName: zod.string().max(200).optional(),
  latitude: zod.number().min(33.4).max(34.2).optional(),
  longitude: zod.number().min(-84.9).max(-83.9).optional(),

  approachStreet: zod.string().min(1).max(120),
  movement: Movement,

  // Demand at the analysis hour.
  hourlyVolumeVph: zod.number().min(0).max(8000),
  // Lane geometry for the movement under analysis.
  laneCount: zod.number().int().min(1).max(6),

  // Signal timing for this approach.
  cycleLengthSec: zod.number().min(30).max(240),
  effectiveGreenSec: zod.number().min(5).max(180),

  // HCM defaults: 1,900 pcphgpl for through, 1,805 for protected left,
  // 1,615 for shared right. Engineer can override for local calibration.
  saturationFlowVphpl: zod.number().min(800).max(2400).optional(),

  // Auxiliary lane storage to compare against.
  availableStorageFt: zod.number().min(0).max(2000).optional(),

  // Spacing per stored vehicle. HCM default 25 ft for passenger cars;
  // 50–60 ft when freight share is high.
  vehicleSpacingFt: zod.number().min(15).max(80).optional(),

  // Analysis period in hours (HCM defaults to 0.25 = 15 min).
  analysisPeriodHr: zod.number().min(0.1).max(2).optional(),
});

export type GenerateQueuingBodyT = zod.infer<typeof GenerateQueuingBody>;

const Verdict = zod.enum(["pass", "marginal", "fail", "not_measured"]);

export const GenerateQueuingResponse = zod.object({
  projectName: zod.string(),
  intersection: zod.object({
    name: zod.string(),
    approach: zod.string(),
    movement: Movement,
  }),
  inputs: zod.object({
    hourlyVolumeVph: zod.number(),
    laneCount: zod.number().int(),
    cycleLengthSec: zod.number(),
    effectiveGreenSec: zod.number(),
    saturationFlowVphpl: zod.number(),
    vehicleSpacingFt: zod.number(),
    analysisPeriodHr: zod.number(),
  }),
  capacity: zod.object({
    perLaneVph: zod.number(),
    totalVph: zod.number(),
    vOverC: zod.number(),
    isOversaturated: zod.boolean(),
  }),
  queue: zod.object({
    averageVehicles: zod.number(),
    averageFt: zod.number(),
    p95Vehicles: zod.number(),
    p95Ft: zod.number(),
  }),
  storage: zod.object({
    availableFt: zod.number().nullable(),
    verdict: Verdict,
    marginFt: zod.number().nullable(),
    requiredFt: zod.number(),
  }),
  notes: zod.array(zod.string()),
  citations: zod.array(zod.string()),
});

export type GenerateQueuingResponseT = zod.infer<typeof GenerateQueuingResponse>;
