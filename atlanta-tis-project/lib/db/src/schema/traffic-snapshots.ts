import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Periodic snapshots of the GDOT 511 incident feed. The api-server runs an
 * interval job that captures the live incident bundle every 10 minutes and
 * writes one row here. Over time this accrues into a proprietary time-series
 * of every Atlanta-metro incident — data that:
 *   1. Cannot be backfilled (the upstream API is live-only).
 *   2. Becomes the basis for our prediction-model recency weights and for
 *      corridor-level reliability scores.
 *   3. A late-arriving competitor literally cannot reproduce — they can
 *      only start collecting from their own day-zero.
 *
 * The payload is the raw `LiveIncidentsBundle` so we never need a schema
 * migration when the upstream shape changes.
 */
export const trafficSnapshotsTable = pgTable(
  "traffic_snapshots",
  {
    id: serial("id").primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    incidentCount: integer("incident_count").notNull().default(0),
    snappedToSignalCount: integer("snapped_to_signal_count").notNull().default(0),
    payload: jsonb("payload").notNull(),
  },
  (table) => [index("IDX_traffic_snapshots_captured").on(table.capturedAt)],
);

export type TrafficSnapshot = typeof trafficSnapshotsTable.$inferSelect;
export type InsertTrafficSnapshot = typeof trafficSnapshotsTable.$inferInsert;
