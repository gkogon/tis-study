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
