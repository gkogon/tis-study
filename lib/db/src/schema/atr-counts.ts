import { sql } from "drizzle-orm";
import {
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
 * Per-15-minute volume bins from Automated Traffic Recorder (ATR) feeds.
 * Replaces the inferred `AADT × K-factor × D-factor` peak-hour
 * estimation in §3 / §3.2 of the state-specific TIS PDFs with real
 * measured hourly volumes by direction.
 *
 * Public TMC (turning-movement-count, per-approach × L/T/R) data does
 * NOT exist at scale — every state DOT and MPO collects TMCs for
 * specific studies and never centralizes them. ATR segment counts are
 * what IS publicly available, and they meaningfully upgrade the
 * Existing Conditions table even though they don't give turn splits.
 *
 * The renderer prose discloses the distinction: ATR is measured
 * directional segment volume, not per-approach turn movements. The
 * engineer verifying the TIS in Synchro / HCS supplies the turn splits
 * from a separate count study (or accepts our distribution model).
 *
 * Source per row:
 *   `nyc_dot_atr` — NYC DOT ATR feed (Socrata 7ym2-wayt). 15-min
 *   bins, lat/lon converted at ingest from NAD83 / NY Long Island
 *   State Plane (EPSG:2263) to WGS84.
 *
 * Denormalized on purpose (one table, not locations+intervals) — the
 * row volume is small enough (~270K rows for a 3-year NYC ingest) that
 * normalizing would only add join cost without meaningful storage
 * savings.
 *
 * Idempotent ingest via UNIQUE(source, source_segment_id, direction,
 * occurred_at). Re-ingesting the same Socrata window is a no-op.
 *
 * Spatial query: bounding-box prefilter + Haversine, same shape as
 * `crashes` to avoid requiring PostGIS on Railway-managed Postgres.
 */
export const atrCountsTable = pgTable(
  "atr_counts",
  {
    id: serial("id").primaryKey(),

    // Provenance.
    source: text("source").notNull(),
    sourceRequestId: text("source_request_id").notNull(),
    sourceSegmentId: text("source_segment_id").notNull(),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // 15 by default for NYC ATR; left configurable for future sources
    // that publish at hourly or 60-min granularity.
    durationMinutes: integer("duration_minutes").notNull().default(15),
    vol: integer("vol").notNull(),

    // Location descriptors. Lat/lon are WGS84, converted from the
    // source's native projection at ingest time so the runtime query
    // path doesn't need proj4.
    street: text("street"),
    fromStreet: text("from_street"),
    toStreet: text("to_street"),
    direction: text("direction"),
    borough: text("borough"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),

    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Idempotent ingest. A (source_segment_id, direction) pair
    // identifies a unique count location-direction; (occurred_at)
    // identifies the 15-min bin.
    uniqueIndex("atr_counts_uniq").on(
      table.source,
      table.sourceSegmentId,
      table.direction,
      table.occurredAt,
    ),

    // Spatial: same pattern as crashes — btree on (lat, lon) plus
    // bounding-box prefilter at query time.
    index("atr_counts_spatial").on(table.latitude, table.longitude),

    // Segment-direction lookup used when the engine has already
    // matched a study intersection to a specific segment id.
    index("atr_counts_segment").on(
      table.sourceSegmentId,
      table.direction,
      table.occurredAt,
    ),
  ],
);

export type AtrCount = typeof atrCountsTable.$inferSelect;
export type InsertAtrCount = typeof atrCountsTable.$inferInsert;
