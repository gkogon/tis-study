import { sql } from "drizzle-orm";
import {
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Trip-generation sample log — the "flywheel" for an independent,
 * ITE-free trip-generation dataset ("ITE 2.0").
 *
 * Every study the engine runs appends ONE row here capturing the inputs
 * (land use, size, location) + the engine's computed trips + the
 * provenance of the rate that produced them. Over time and usage this
 * accumulates into an owned dataset the engine's own rates can be
 * re-derived / calibrated from — the data moat that compounds with
 * traction (the more studies run, the better the rates get).
 *
 * Append-only. Written fire-and-forget (see lib/trip-gen-samples.ts in
 * the API server) so it can NEVER affect a study response. Never read on
 * the hot path — this is an offline derivation source.
 *
 * `daily_trips` / `am_trips` / `pm_trips` are the engine's PREDICTED trips
 * (rate × size). The `observed_*` columns are reserved for when real
 * measured driveway counts can be matched back to a site — predicted-vs-
 * observed is what eventually lets us re-fit our own rate curves.
 *
 * firmId / userId are nullable: anonymous /demo and /trics runs are valid
 * samples too (the inputs + computed trips are real regardless of who ran
 * them). `metadata` carries optional context without a migration.
 */
export const tripGenSamplesTable = pgTable(
  "trip_gen_samples",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    landUseCode: varchar("land_use_code", { length: 16 }).notNull(),
    landUseName: varchar("land_use_name", { length: 128 }),
    unit: varchar("unit", { length: 32 }),
    size: doublePrecision("size"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    regionCode: varchar("region_code", { length: 48 }),
    dailyTrips: integer("daily_trips"),
    amTrips: integer("am_trips"),
    pmTrips: integer("pm_trips"),
    rateConfidence: varchar("rate_confidence", { length: 32 }),
    rateSource: varchar("rate_source", { length: 512 }),
    // Reserved for future predicted-vs-actual calibration:
    observedDailyTrips: integer("observed_daily_trips"),
    observedSource: varchar("observed_source", { length: 128 }),
    firmId: varchar("firm_id"),
    userId: varchar("user_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("IDX_tgs_landuse_created").on(table.landUseCode, table.createdAt),
    index("IDX_tgs_region").on(table.regionCode),
    index("IDX_tgs_created").on(table.createdAt),
  ],
);

export type TripGenSample = typeof tripGenSamplesTable.$inferSelect;
export type InsertTripGenSample = typeof tripGenSamplesTable.$inferInsert;
