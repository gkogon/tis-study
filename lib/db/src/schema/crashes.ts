import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Per-crash records ingested from public state / city open-data feeds.
 * Powers the §4 (NYSDOT) / §5 (FDOT/Caltrans/GDOT) crash analysis
 * section every state TIS shell currently leaves blank in our output.
 *
 * One row = one police-reported crash. Records are sourced per
 * jurisdiction's preferred open dataset (NYC OpenData h9gi-nx95, FL
 * Signal4, GA GEARS where available, etc.); the `source` column tags
 * provenance so we never blend incompatible methodologies into one
 * aggregate.
 *
 * Severity uses the standard KABCO scale: K fatal · A severe injury ·
 * B moderate · C minor · O property damage only · UNKNOWN where the
 * source did not encode severity.
 *
 * locationPrecision = `precise` (lat/lon to within ±10m, jurisdiction
 * pinned the crash to an intersection or block), `approximate` (we
 * have municipality + road but no coords — typical of NYS public
 * extract), or `segment` (we have a milepoint-style reference on a
 * known route, no precise coords).
 *
 * Indexed for the only two query shapes the TIS engine runs:
 *   1. Spatial: "crashes within radius R of (lat, lon) in last N
 *      years" — covered by (latitude, longitude) + occurredAt indexes.
 *   2. Approximate: "crashes on road X in municipality Y" — covered
 *      by (municipality, onStreet) for the no-coord NYS public extract
 *      and similar.
 *
 * The raw payload is intentionally NOT stored — at typical state-DOT
 * scale (2-5M crashes per state per decade), retaining the raw blob
 * doubles row size and trades a real GB of disk for marginal audit
 * value. Every record carries `source` + `sourceRecordId` so an
 * engineer can re-query the upstream dataset directly when they need
 * a forensic-level look.
 */
export const crashesTable = pgTable(
  "crashes",
  {
    id: serial("id").primaryKey(),

    // Provenance — never blend records from different sources without
    // tagging which methodology was used to classify each one.
    source: text("source").notNull(),
    sourceRecordId: text("source_record_id").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    // KABCO severity. UNKNOWN where the source did not encode it.
    severity: text("severity").notNull(),

    // Location. Coords nullable because state extracts (e.g. NYS
    // public ALIS) drop them for privacy; the engine uses an
    // approximate match path in that case.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationPrecision: text("location_precision").notNull(),
    municipality: text("municipality"),
    county: text("county"),
    onStreet: text("on_street"),
    crossStreet: text("cross_street"),

    // Categorization — variations carry through to the §4 crash
    // breakdown (rear-end / angle / sideswipe / pedestrian / etc).
    mannerOfCollision: text("manner_of_collision"),

    // Conditions — used in the per-condition tabulation and for
    // surfacing patterns ("60% of crashes at this intersection
    // happened in wet/dark conditions").
    lighting: text("lighting"),
    weather: text("weather"),
    surface: text("surface"),

    numVehicles: integer("num_vehicles"),
    pedestrianInvolved: boolean("pedestrian_involved").notNull().default(false),
    cyclistInvolved: boolean("cyclist_involved").notNull().default(false),

    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Idempotent ingest: re-running the ingest script must update,
    // not duplicate. The combination (source, sourceRecordId) is the
    // upstream dataset's row identifier — guaranteed unique by the
    // source.
    uniqueIndex("crashes_source_record_unique").on(
      table.source,
      table.sourceRecordId,
    ),

    // Spatial. PostGIS would be nicer but we don't assume it on
    // Railway Postgres — a btree on (lat, lon) plus a bounding-box
    // pre-filter in the query gets us within an order of magnitude
    // of a GIST/SP-GIST point index for the radii TIS uses (≤1 mi).
    index("crashes_spatial").on(table.latitude, table.longitude),

    // Date filter — every TIS query asks for "last N years."
    index("crashes_occurred").on(table.occurredAt),

    // Approximate path — used when locationPrecision='approximate'
    // (NYS public extract has no coords; we match on municipality +
    // road name).
    index("crashes_approx_match").on(table.municipality, table.onStreet),

    check(
      "crashes_severity_valid",
      sql`${table.severity} IN ('K','A','B','C','O','UNKNOWN')`,
    ),
    check(
      "crashes_location_precision_valid",
      sql`${table.locationPrecision} IN ('precise','approximate','segment')`,
    ),
    // If precision is precise/segment, coords must exist; if
    // approximate, they may be null. Belt-and-suspenders against
    // ingest bugs writing a "precise" row with null coords.
    check(
      "crashes_precise_has_coords",
      sql`${table.locationPrecision} != 'precise' OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL)`,
    ),
  ],
);

export type Crash = typeof crashesTable.$inferSelect;
export type InsertCrash = typeof crashesTable.$inferInsert;
