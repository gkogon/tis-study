import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Append-only audit log of meaningful calibration adjustments.
 *
 * The hourly calibration worker rewrites every eligible row in
 * `intersection_calibration`, but most multipliers barely move
 * hour-to-hour (the 7-day snapshot window slides slowly). This table
 * records only *meaningful* movement — a row is appended when an
 * intersection's delayMultiplier shifts by ≥0.01, or when an
 * intersection is calibrated for the first time.
 *
 * Two jobs:
 *   1. Powers the public "live calibration activity" counter on the
 *      marketing site — proof the self-improving algorithm is real.
 *   2. Timestamped evidence of autonomous algorithmic adjustment —
 *      directly relevant to the provisional patent on the
 *      calibration-feedback system.
 *
 * Append-only and small (tens of rows per hour). The changed_at index
 * keeps the "changes in the last hour" query fast indefinitely; no
 * pruning needed for years.
 */
export const calibrationChangesTable = pgTable(
  "calibration_changes",
  {
    id: serial("id").primaryKey(),
    intersectionId: text("intersection_id").notNull(),
    // Null when this is the intersection's first-ever calibration.
    oldMultiplier: doublePrecision("old_multiplier"),
    newMultiplier: doublePrecision("new_multiplier").notNull(),
    // The incident-pressure score that drove the new multiplier.
    pressure: doublePrecision("pressure").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("IDX_calibration_changes_changed_at").on(table.changedAt)],
);

export type CalibrationChange = typeof calibrationChangesTable.$inferSelect;
export type InsertCalibrationChange = typeof calibrationChangesTable.$inferInsert;
