/**
 * Hand-written Zod schemas for the Sight Distance Analysis endpoint
 * (AASHTO Green Book 7th Ed.).
 *
 * Two checks per evaluation:
 *   - Stopping Sight Distance (SSD) — driver on the major street must
 *     see far enough to stop for an obstacle in the through lane.
 *   - Intersection Sight Distance (ISD) — driver on the minor approach
 *     (stop-controlled) must see far enough up the major street to
 *     execute the requested maneuver safely.
 *
 * Engineers should override `perceptionReactionSec` and
 * `decelerationFtPerSec2` when local guidance or vehicle-class
 * conventions differ from AASHTO defaults.
 */
import * as zod from "zod";

const Maneuver = zod.enum(["left_from_minor", "right_from_minor", "crossing_from_minor"]);
const VehicleClass = zod.enum(["passenger_car", "single_unit_truck", "combination_truck"]);

export const GenerateSightDistanceBody = zod.object({
  projectName: zod.string().min(1).max(200),
  intersectionName: zod.string().max(200).optional(),
  latitude: zod.number().min(33.4).max(34.2).optional(),
  longitude: zod.number().min(-84.9).max(-83.9).optional(),

  // Major (through) street where the driver is observing or being seen.
  majorStreet: zod.object({
    name: zod.string().max(120),
    designSpeedMph: zod.number().min(15).max(75),
    approachGradePct: zod.number().min(-15).max(15).optional(),
  }),
  minorStreet: zod.object({
    name: zod.string().max(120),
    // How many lanes the minor-approach driver must cross before
    // entering the major's nearest through lane. Drives ISD adjustment.
    lanesToCross: zod.number().int().min(0).max(8).optional(),
  }),

  maneuver: Maneuver,
  vehicleClass: VehicleClass.optional(),

  // Measured / observed sight distances at the candidate location.
  availableSsdFt: zod.number().min(0).max(2000).optional(),
  availableIsdFt: zod.number().min(0).max(2000).optional(),

  // AASHTO defaults: 2.5 s perception-reaction, 11.2 ft/s² deceleration.
  perceptionReactionSec: zod.number().min(1).max(5).optional(),
  decelerationFtPerSec2: zod.number().min(5).max(20).optional(),
});

export type GenerateSightDistanceBodyT = zod.infer<typeof GenerateSightDistanceBody>;

const Verdict = zod.enum(["pass", "marginal", "fail", "not_measured"]);

export const GenerateSightDistanceResponse = zod.object({
  projectName: zod.string(),
  intersection: zod.object({
    name: zod.string(),
    major: zod.string(),
    minor: zod.string(),
    designSpeedMph: zod.number(),
  }),
  inputs: zod.object({
    maneuver: Maneuver,
    vehicleClass: VehicleClass,
    perceptionReactionSec: zod.number(),
    decelerationFtPerSec2: zod.number(),
    approachGradePct: zod.number(),
    lanesToCross: zod.number().int(),
  }),
  ssd: zod.object({
    requiredFt: zod.number(),
    availableFt: zod.number().nullable(),
    verdict: Verdict,
    marginFt: zod.number().nullable(),
    notes: zod.array(zod.string()),
  }),
  isd: zod.object({
    requiredFt: zod.number(),
    availableFt: zod.number().nullable(),
    verdict: Verdict,
    marginFt: zod.number().nullable(),
    timeGapSec: zod.number(),
    notes: zod.array(zod.string()),
  }),
  citations: zod.array(zod.string()),
});

export type GenerateSightDistanceResponseT = zod.infer<typeof GenerateSightDistanceResponse>;
