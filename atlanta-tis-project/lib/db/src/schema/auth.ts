import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// Server-side session store. Cookies hold only the opaque sid; the
// actual session data lives in this table.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users — historically created by Replit Auth (OIDC); since the
// Phase-13 migration the canonical path is email + password
// (passwordHash set). Legacy OIDC rows and dev-auth rows leave
// passwordHash null and authenticate via their respective code paths
// (which we keep for now so existing data isn't orphaned).
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // bcrypt hash. Null if the user authenticates exclusively via
  // dev-auth or OIDC.
  passwordHash: varchar("password_hash"),
  // Password-reset state. Token is a random URL-safe string sent via
  // email; the companion timestamp gates how long the link is valid
  // (typically 1 hour from issue).
  passwordResetToken: varchar("password_reset_token"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
