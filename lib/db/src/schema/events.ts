import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Funnel / product-analytics event log.
 *
 * Append-only stream of the handful of server-side events that
 * actually matter for understanding the acquisition funnel:
 *
 *   demo_run          a non-signed-in visitor ran a /demo study
 *   signup            a new account + firm was created
 *   study_generated   a real (signed-in) study completed
 *   checkout_started  a Stripe Checkout session was created
 *   quota_hit         a firm hit its period study cap (402)
 *
 * The point: when cold outbound starts, this is the difference
 * between "I sent 50 emails and hope" and "50 emails → 12 demo runs
 * → 3 signups → 1 checkout — the drop-off is demo→signup, fix that."
 *
 * Deliberately server-side only — no page-view beacons, no client
 * instrumentation, no third-party analytics SDK. These five events
 * are the real funnel stages and they're all cleanly observable on
 * the backend. Page-level analytics can come later via a dedicated
 * tool (Plausible etc.) if it's ever worth it.
 *
 * firmId / userId are nullable: demo_run events are anonymous.
 * `metadata` carries event-specific context (plan, presetId,
 * studyType, …) without needing a migration per event type.
 */
export const eventsTable = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    firmId: varchar("firm_id"),
    userId: varchar("user_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("IDX_events_type_created").on(table.eventType, table.createdAt),
    index("IDX_events_created").on(table.createdAt),
  ],
);

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
