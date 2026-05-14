import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Email opt-out list. CAN-SPAM compliance for outbound marketing
 * emails (cold outreach to engineering firms, drip campaigns, future
 * newsletter). Email is the PK so a duplicate POST to /api/unsubscribe
 * is idempotent.
 *
 * Transactional emails (password reset, billing receipt, firm
 * invite) are exempt from CAN-SPAM and continue to send even if the
 * address is on this list — see callers of `isOptedOut`. We could
 * add a `category` column later if we ever offer per-topic
 * subscription preferences, but until we run more than one
 * marketing program a single opt-out is sufficient.
 */
export const emailOptoutsTable = pgTable(
  "email_optouts",
  {
    // Lowercased before insert; checked lowercased on lookup so casing
    // can't be used to circumvent an opt-out.
    email: varchar("email", { length: 254 }).primaryKey(),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Where the opt-out came from — used for analytics on which
    // outbound channels generate the most unsubscribes. Set by the
    // /api/unsubscribe endpoint based on a `source` query param the
    // unsubscribe link can pass through.
    source: varchar("source", { length: 64 }),
    // Optional free-text reason from the user. Kept short and
    // user-supplied; never used to send a follow-up.
    reason: text("reason"),
  },
  (table) => [index("IDX_email_optouts_opted_out_at").on(table.optedOutAt)],
);

export type EmailOptout = typeof emailOptoutsTable.$inferSelect;
export type InsertEmailOptout = typeof emailOptoutsTable.$inferInsert;
