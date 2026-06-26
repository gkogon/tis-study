import { sql } from "drizzle-orm";
import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const tisUsageTable = pgTable("tis_usage", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  completedCount: integer("completed_count").notNull().default(0),
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
  stripeCustomerId: varchar("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
});

export type TisUsage = typeof tisUsageTable.$inferSelect;
export type InsertTisUsage = typeof tisUsageTable.$inferInsert;

/**
 * Stripe webhook idempotency ledger. Stripe delivers events at-least-once
 * — it retries any non-2xx response, and a network blip can deliver the
 * same event twice — so every handler must be replay-safe. We record each
 * processed event id (the PK) and skip any event already present. Without
 * this, a replayed `invoice.paid` re-grants a billing period's study quota
 * (free studies) and a replayed subscription event re-applies stale plan
 * state. See artifacts/tis-api-server/src/routes/stripe-webhook.ts.
 */
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  // Stripe event id, e.g. "evt_1Abc...". As the primary key it gives us
  // atomic dedup: a duplicate insert raises a unique violation, which the
  // handler treats as "already processed."
  id: varchar("id").primaryKey(),
  type: varchar("type", { length: 64 }),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;
export type InsertStripeWebhookEvent = typeof stripeWebhookEventsTable.$inferInsert;
