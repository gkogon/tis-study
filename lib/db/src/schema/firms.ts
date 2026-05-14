import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * A firm = the billing unit. One engineering firm has one row here,
 * multiple users (engineers) attached via `firmMembersTable`. All TIS
 * projects, branding, and Stripe state live at this level so the firm
 * is what the customer thinks of as "their account."
 */
export const firmsTable = pgTable("firms", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  // URL-safe identifier, generated from name on create. Reserved for
  // future per-firm subdomains or vanity URLs.
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  // Logo asset for white-labeled PDFs. Object storage URL.
  logoUrl: text("logo_url"),

  // Stripe linkage. customerId is created on first billing action;
  // subscriptionId is set after Checkout completes.
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),

  // Plan tier drives seat + study quotas. 'trial' is the implicit state
  // for a freshly-created firm with no subscription yet.
  planTier: varchar("plan_tier", { length: 32 }).notNull().default("trial"),
  // Mirrors Stripe's subscription.status verbatim so we can render
  // accurate billing UI without re-querying Stripe on every page load.
  subscriptionStatus: varchar("subscription_status", { length: 32 }),

  // Quota state. Resets on every Stripe invoice.paid webhook.
  seatLimit: integer("seat_limit").notNull().default(3),
  studyLimit: integer("study_limit").notNull().default(3),
  studiesUsedThisPeriod: integer("studies_used_this_period")
    .notNull()
    .default(0),
  // Period bounds copied from the active Stripe subscription. Null
  // during trial.
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
}, (table) => [
  // Stripe webhook handlers look up firms by stripeCustomerId on every
  // event — index it so the lookup stays cheap as we grow past the
  // dozens-of-firms mark. Partial: nullable column, only ~25% of rows
  // (paid customers) will appear in the index.
  index("IDX_firms_stripe_customer_id")
    .on(table.stripeCustomerId)
    .where(sql`${table.stripeCustomerId} IS NOT NULL`),
]);

export type Firm = typeof firmsTable.$inferSelect;
export type InsertFirm = typeof firmsTable.$inferInsert;

/**
 * Join table: which users belong to which firm and in what role.
 * A user can belong to multiple firms (consultant working across two
 * partner firms), but in practice the UI will assume one active firm
 * at a time.
 */
export const firmMembersTable = pgTable(
  "firm_members",
  {
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // 'owner' has billing access; 'admin' can invite; 'member' can generate.
    role: varchar("role", { length: 16 }).notNull().default("member"),
    invitedByUserId: varchar("invited_by_user_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    primaryKey({ columns: [table.firmId, table.userId] }),
    index("IDX_firm_members_user").on(table.userId),
  ],
);

export type FirmMember = typeof firmMembersTable.$inferSelect;
export type InsertFirmMember = typeof firmMembersTable.$inferInsert;

/**
 * Pending invitations. A row exists from the moment an admin sends an
 * invite until the invitee either accepts (acceptedAt set) or it
 * expires. We keep accepted rows for audit; expired rows can be GCed.
 */
export const firmInvitesTable = pgTable(
  "firm_invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    email: varchar("email").notNull(),
    role: varchar("role", { length: 16 }).notNull().default("member"),
    // Random URL-safe token included in the invite link.
    token: varchar("token").notNull().unique(),
    invitedByUserId: varchar("invited_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index("IDX_firm_invites_firm").on(table.firmId)],
);

export type FirmInvite = typeof firmInvitesTable.$inferSelect;
export type InsertFirmInvite = typeof firmInvitesTable.$inferInsert;
