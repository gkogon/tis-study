import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Per-intersection calibration multipliers. The TIS engine multiplies the
 * HCM-computed control delay by `delayMultiplier` when a row exists, then
 * stamps a "calibrated against N samples" badge on the report so reviewers
 * can see this isn't pure textbook math.
 *
 * Empty by default — rows are added as we accumulate ground-truth observations
 * (drive-time samples, archived 511 corridor delays, post-construction TIS
 * audits). Until then the engine falls back to the unmodified HCM result.
 *
 * This is the data-defensibility moat: once we have 50+ Atlanta intersections
 * calibrated against observed delay, a generic-HCM clone is meaningfully less
 * accurate than us.
 */
export const intersectionCalibrationTable = pgTable(
  "intersection_calibration",
  {
    intersectionId: text("intersection_id").primaryKey(),
    delayMultiplier: doublePrecision("delay_multiplier").notNull().default(1.0),
    sampleCount: integer("sample_count").notNull().default(0),
    lastObservedDelaySec: doublePrecision("last_observed_delay_sec"),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Defense-in-depth: the engine clamps to [0.25, 5] but a sentinel
    // CHECK at the DB layer prevents bad ingestion writes from ever
    // reaching the engine. lastObservedDelaySec must be non-negative
    // when present.
    check(
      "intersection_calibration_multiplier_range",
      sql`${table.delayMultiplier} > 0 AND ${table.delayMultiplier} <= 10`,
    ),
    check(
      "intersection_calibration_sample_count_nonneg",
      sql`${table.sampleCount} >= 0`,
    ),
    check(
      "intersection_calibration_observed_nonneg",
      sql`${table.lastObservedDelaySec} IS NULL OR ${table.lastObservedDelaySec} >= 0`,
    ),
  ],
);

export type IntersectionCalibration = typeof intersectionCalibrationTable.$inferSelect;
export type InsertIntersectionCalibration = typeof intersectionCalibrationTable.$inferInsert;
